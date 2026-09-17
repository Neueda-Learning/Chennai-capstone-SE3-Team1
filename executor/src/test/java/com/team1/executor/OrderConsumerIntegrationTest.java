package com.team1.executor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.eventbus.Envelope;
import com.team1.executor.consumer.OrderConsumer;
import com.team1.executor.error.DeadLetterService;
import com.team1.executor.error.ErrorCategory;
import com.team1.executor.error.ErrorClassifier;
import com.team1.executor.error.ErrorContext;
import com.team1.executor.error.RetryHandler;
import com.team1.executor.mapper.InstrumentMapper;
import com.team1.executor.model.InstrumentRow;
import com.team1.executor.model.OrderPlacedPayload;
import com.team1.executor.model.QuoteResponse;
import com.team1.executor.quote.FauxnanceQuoteClient;
import com.team1.executor.rule.FillDecision;
import com.team1.executor.rule.FillRuleResult;
import com.team1.executor.settlement.SettlementService;
import com.team1.trading.domain.entity.Order;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.Acknowledgment;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Integration tests for OrderConsumer.
 * 
 * These tests verify the happy path (successful processing) and key error execution routes.
 * For deep retry and dead-letter scenarios, see OrderConsumerRetryAndDLTTest.
 */
@ExtendWith(MockitoExtension.class)
class OrderConsumerIntegrationTest {

    @Mock
    private InstrumentMapper instrumentMapper;
    @Mock
    private FauxnanceQuoteClient quoteClient;
    @Mock
    private SettlementService settlementService;
    @Mock
    private KafkaTemplate<String, Object> kafkaTemplate;
    @Mock
    private Acknowledgment ack;
    @Mock
    private ErrorClassifier errorClassifier;
    @Mock
    private RetryHandler retryHandler;
    @Mock
    private DeadLetterService deadLetterService;

    private OrderConsumer consumer;

    @Captor
    private ArgumentCaptor<Envelope> envelopeCaptor;

    private final ObjectMapper objectMapper = new ObjectMapper()
        .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    @BeforeEach
    void setUp() {
        consumer = new OrderConsumer(
            instrumentMapper, quoteClient, settlementService, kafkaTemplate, 
            objectMapper, errorClassifier, retryHandler, deadLetterService);
    }

    @Test
    void fillBuyOrderAtAsk() {
        String symbol = "ACME";
        UUID orderId = UUID.randomUUID();
        Long accountId = 1L;
        BigDecimal limitPrice = new BigDecimal("100.05");
        BigDecimal ask = new BigDecimal("100.05");
        BigDecimal bid = new BigDecimal("99.95");

        OrderPlacedPayload payload = new OrderPlacedPayload(
                orderId, accountId, symbol, "BUY", 10, limitPrice, "idem-1", Instant.now());
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
                "trade-api", 1, objectMapper.valueToTree(payload));

        ConsumerRecord<String, Envelope> record =
                new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        InstrumentRow instrument = new InstrumentRow(symbol, "ACME Corp", true, null);
        when(instrumentMapper.findBySymbol(symbol)).thenReturn(Optional.of(instrument));

        QuoteResponse quote = new QuoteResponse(symbol, BigDecimal.valueOf(100), ask, bid, "USD",
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, "open", false, Instant.now());
        when(quoteClient.getQuote(symbol)).thenReturn(quote);

        SettlementService.SettlementResult settlementResult = SettlementService.SettlementResult.success(
                FillDecision.FILL, ask);
        when(settlementService.settle(any(Order.class), any(FillRuleResult.class), any()))
                .thenReturn(settlementResult);

        consumer.consume(record, ack, 0, 0L);

        verify(ack).acknowledge();
        verify(kafkaTemplate).send(eq("trade-events"), eq(String.valueOf(accountId)), envelopeCaptor.capture());
        verify(deadLetterService, never()).sendToDLT(anyString(), any(Envelope.class), any());

        Envelope sentEnvelope = envelopeCaptor.getValue();
        assertThat(sentEnvelope.eventType()).isEqualTo("ORDER_FILLED");
    }

    @Test
    void fillSellOrderAtBid() {
        String symbol = "ACME";
        UUID orderId = UUID.randomUUID();
        Long accountId = 1L;
        BigDecimal limitPrice = new BigDecimal("99.95");
        BigDecimal ask = new BigDecimal("100.05");
        BigDecimal bid = new BigDecimal("99.95");

        OrderPlacedPayload payload = new OrderPlacedPayload(
                orderId, accountId, symbol, "SELL", 10, limitPrice, "idem-1", Instant.now());
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
                "trade-api", 1, objectMapper.valueToTree(payload));

        ConsumerRecord<String, Envelope> record =
                new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        InstrumentRow instrument = new InstrumentRow(symbol, "ACME Corp", true, null);
        when(instrumentMapper.findBySymbol(symbol)).thenReturn(Optional.of(instrument));

        QuoteResponse quote = new QuoteResponse(symbol, BigDecimal.valueOf(100), ask, bid, "USD",
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, "open", false, Instant.now());
        when(quoteClient.getQuote(symbol)).thenReturn(quote);

        SettlementService.SettlementResult settlementResult = SettlementService.SettlementResult.success(
                FillDecision.FILL, bid);
        when(settlementService.settle(any(Order.class), any(FillRuleResult.class), any()))
                .thenReturn(settlementResult);

        consumer.consume(record, ack, 0, 0L);

        verify(ack).acknowledge();
        verify(kafkaTemplate).send(eq("trade-events"), eq(String.valueOf(accountId)), envelopeCaptor.capture());
        verify(deadLetterService, never()).sendToDLT(anyString(), any(Envelope.class), any());

        Envelope sentEnvelope = envelopeCaptor.getValue();
        assertThat(sentEnvelope.eventType()).isEqualTo("ORDER_FILLED");
    }

    @Test
    void rejectBuyOrderBelowAsk() {
        String symbol = "ACME";
        UUID orderId = UUID.randomUUID();
        Long accountId = 1L;
        BigDecimal limitPrice = new BigDecimal("100.00");
        BigDecimal ask = new BigDecimal("100.05");

        OrderPlacedPayload payload = new OrderPlacedPayload(
                orderId, accountId, symbol, "BUY", 10, limitPrice, "idem-1", Instant.now());
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
                "trade-api", 1, objectMapper.valueToTree(payload));

        ConsumerRecord<String, Envelope> record =
                new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        InstrumentRow instrument = new InstrumentRow(symbol, "ACME Corp", true, null);
        when(instrumentMapper.findBySymbol(symbol)).thenReturn(Optional.of(instrument));

        QuoteResponse quote = new QuoteResponse(symbol, BigDecimal.valueOf(100), ask, new BigDecimal("99.95"), "USD",
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, "open", false, Instant.now());
        when(quoteClient.getQuote(symbol)).thenReturn(quote);

        SettlementService.SettlementResult settlementResult = SettlementService.SettlementResult.success(
                FillDecision.REJECT, null);
        when(settlementService.settle(any(Order.class), any(FillRuleResult.class), any()))
                .thenReturn(settlementResult);

        consumer.consume(record, ack, 0, 0L);

        verify(ack).acknowledge();
        verify(kafkaTemplate).send(eq("trade-events"), eq(String.valueOf(accountId)), envelopeCaptor.capture());
        verify(deadLetterService, never()).sendToDLT(anyString(), any(Envelope.class), any());

        Envelope sentEnvelope = envelopeCaptor.getValue();
        assertThat(sentEnvelope.eventType()).isEqualTo("ORDER_REJECTED");
    }

    @Test
    void permanentFauxnanceErrorRejectsOrderWithoutRetry() {
        // Stub classifier to return QUOTE_FETCH_PERMANENT context
        Mockito.when(errorClassifier.classify(any(Exception.class), anyString()))
               .thenReturn(new ErrorContext(
                   ErrorCategory.QUOTE_FETCH_PERMANENT,
                   false,
                   1,
                   "QUOTE_FETCH_QUOTA_EXHAUSTED",
                   "Quota limit reached",
                   "FauxnanceQuoteClient$QuotaExhausted"
               ));

        String symbol = "ACME";
        UUID orderId = UUID.randomUUID();
        Long accountId = 1L;

        OrderPlacedPayload payload = new OrderPlacedPayload(
                orderId, accountId, symbol, "BUY", 10, new BigDecimal("100.00"), "idem-1", Instant.now());
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
                "trade-api", 1, objectMapper.valueToTree(payload));

        ConsumerRecord<String, Envelope> record =
                new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        InstrumentRow instrument = new InstrumentRow(symbol, "ACME Corp", true, null);
        when(instrumentMapper.findBySymbol(symbol)).thenReturn(Optional.of(instrument));

        // Simulate quota exhausted (permanent error)
        when(quoteClient.getQuote(symbol))
            .thenThrow(new FauxnanceQuoteClient.QuotaExhausted("Daily quota exhausted"));

        consumer.consume(record, ack, 0, 0L);

        verify(ack).acknowledge();
        // Should publish ORDER_REJECTED directly without retry or DLT
        verify(kafkaTemplate).send(eq("trade-events"), eq(String.valueOf(accountId)), envelopeCaptor.capture());
        verify(deadLetterService, never()).sendToDLT(anyString(), any(Envelope.class), any());

        Envelope sentEnvelope = envelopeCaptor.getValue();
        assertThat(sentEnvelope.eventType()).isEqualTo("ORDER_REJECTED");
    }

    @Test
    void alreadySettledOrderDoesNotProcessAgain() {
        String symbol = "ACME";
        UUID orderId = UUID.randomUUID();
        Long accountId = 1L;

        OrderPlacedPayload payload = new OrderPlacedPayload(
                orderId, accountId, symbol, "BUY", 10, new BigDecimal("100.05"), "idem-1", Instant.now());
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
                "trade-api", 1, objectMapper.valueToTree(payload));

        ConsumerRecord<String, Envelope> record =
                new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        InstrumentRow instrument = new InstrumentRow(symbol, "ACME Corp", true, null);
        when(instrumentMapper.findBySymbol(symbol)).thenReturn(Optional.of(instrument));

        QuoteResponse quote = new QuoteResponse(symbol, BigDecimal.valueOf(100), new BigDecimal("100.05"), new BigDecimal("99.95"), "USD",
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, "open", false, Instant.now());
        when(quoteClient.getQuote(symbol)).thenReturn(quote);

        SettlementService.SettlementResult settlementResult = SettlementService.SettlementResult.alreadySettled("FILLED");
        when(settlementService.settle(any(Order.class), any(FillRuleResult.class), any()))
                .thenReturn(settlementResult);

        consumer.consume(record, ack, 0, 0L);

        verify(ack).acknowledge();
        // On replay: no duplicate trade event, no DLT
        verify(kafkaTemplate, never()).send(anyString(), anyString(), any());
        verify(deadLetterService, never()).sendToDLT(anyString(), any(Envelope.class), any());
    }
}