package com.team1.executor;

import com.team1.eventbus.Envelope;
import com.team1.executor.consumer.OrderConsumer;
import com.team1.executor.error.DeadLetterService;
import com.team1.executor.error.ErrorCategory;
import com.team1.executor.error.ErrorClassifier;
import com.team1.executor.error.ErrorContext;
import com.team1.executor.error.RetryHandler;
import com.team1.executor.mapper.InstrumentMapper;
import com.team1.executor.model.*;
import com.team1.executor.quote.FauxnanceQuoteClient;
import com.team1.executor.rule.FillDecision;
import com.team1.executor.settlement.SettlementService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.CannotGetJdbcConnectionException;

import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.Acknowledgment;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("OrderConsumer Dead-Letter and Retry Tests")
class OrderConsumerRetryAndDLTTest {

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
    private DeadLetterService deadLetterService;

    private ErrorClassifier errorClassifier;
    private RetryHandler retryHandler;
    private OrderConsumer consumer;

    @Captor
    private ArgumentCaptor<String> keyCaptor;
    @Captor
    private ArgumentCaptor<Envelope> envelopeCaptor;
    @Captor
    private ArgumentCaptor<ErrorContext> errorContextCaptor;

    private final ObjectMapper objectMapper = new ObjectMapper()
        .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    @BeforeEach
    void setUp() {
        errorClassifier = new ErrorClassifier(3);
        retryHandler = new RetryHandler(100, 2.0);

        consumer = new OrderConsumer(
            instrumentMapper, quoteClient, settlementService, kafkaTemplate,
            objectMapper, errorClassifier, retryHandler, deadLetterService);
    }

    @Test
    @DisplayName("Malformed JSON is dead-lettered on first attempt, no retries")
    void malformedJsonDeadLetteredImmediately() throws InterruptedException {
        String symbol = "ACME";
        UUID orderId = UUID.randomUUID();
        Long accountId = 1L;

        OrderPlacedPayload payload = new OrderPlacedPayload(
            orderId, accountId, symbol, "BUY", 10, new BigDecimal("100.00"), "idem-1", Instant.now());
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
            "trade-api", 1, objectMapper.valueToTree(payload));

        ConsumerRecord<String, Envelope> record =
            new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        when(instrumentMapper.findBySymbol(symbol))
            .thenThrow(new NullPointerException("Null instrument"));

        consumer.consume(record, ack, 0, 0L);

        verify(deadLetterService, times(1)).sendToDLT(
            eq(String.valueOf(accountId)), eq(envelope), any(ErrorContext.class));
        verify(ack, times(1)).acknowledge();
    }

    @Test
    @DisplayName("Missing required field (null payload) is dead-lettered immediately")
    void missingRequiredFieldDeadLetteredImmediately() {
        Long accountId = 1L;
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
            "trade-api", 1, null);

        ConsumerRecord<String, Envelope> record =
            new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        consumer.consume(record, ack, 0, 0L);

        verify(deadLetterService, times(1)).sendToDLT(
            eq(String.valueOf(accountId)), eq(envelope), any(ErrorContext.class));
        verify(ack, times(1)).acknowledge();
        verify(quoteClient, never()).getQuote(anyString());
    }

    @Test
    @DisplayName("Order not found in database is dead-lettered immediately")
    void orderNotFoundDeadLetteredImmediately() {
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

        QuoteResponse quote = new QuoteResponse(symbol, new BigDecimal("100"), new BigDecimal("100.05"),
            new BigDecimal("99.95"), "USD", BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
            "open", false, Instant.now());
        when(quoteClient.getQuote(symbol)).thenReturn(quote);

        when(settlementService.settle(any(), any(), any()))
            .thenReturn(SettlementService.SettlementResult.orderNotFound());

        consumer.consume(record, ack, 0, 0L);

        verify(deadLetterService, times(1)).sendToDLT(
            keyCaptor.capture(), envelopeCaptor.capture(), errorContextCaptor.capture());
        verify(ack, times(1)).acknowledge();

        assertThat(errorContextCaptor.getValue().category())
            .isEqualTo(ErrorCategory.ORDER_NOT_FOUND);
    }

    @Test
    @DisplayName("Quote fetch timeout is retried and succeeds on second attempt")
    void quoteFetchTimeoutRetriedAndSucceeds() throws InterruptedException {
        String symbol = "ACME";
        UUID orderId = UUID.randomUUID();
        Long accountId = 1L;
        BigDecimal ask = new BigDecimal("100.05");

        OrderPlacedPayload payload = new OrderPlacedPayload(
            orderId, accountId, symbol, "BUY", 10, new BigDecimal("100.00"), "idem-1", Instant.now());
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
            "trade-api", 1, objectMapper.valueToTree(payload));

        ConsumerRecord<String, Envelope> record =
            new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        InstrumentRow instrument = new InstrumentRow(symbol, "ACME Corp", true, null);
        when(instrumentMapper.findBySymbol(symbol)).thenReturn(Optional.of(instrument));

        QuoteResponse quote = new QuoteResponse(symbol, new BigDecimal("100"), ask,
            new BigDecimal("99.95"), "USD", BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
            "open", false, Instant.now());

        when(quoteClient.getQuote(symbol))
            .thenThrow(new FauxnanceQuoteClient.ServiceUnreachable("Fauxnance timeout"))
            .thenReturn(quote);

        when(settlementService.settle(any(), any(), any()))
            .thenReturn(SettlementService.SettlementResult.success(FillDecision.FILL, ask, 10, ask));

        consumer.consume(record, ack, 0, 0L);

        verify(quoteClient, times(2)).getQuote(symbol);
        verify(deadLetterService, never()).sendToDLT(anyString(), any(), any());
        verify(kafkaTemplate).send(eq("trade-events"), eq(String.valueOf(accountId)), any());
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("Database connection error is retried")
    void databaseConnectionErrorRetried() throws InterruptedException {
        String symbol = "ACME";
        UUID orderId = UUID.randomUUID();
        Long accountId = 1L;
        BigDecimal ask = new BigDecimal("100.05");

        OrderPlacedPayload payload = new OrderPlacedPayload(
            orderId, accountId, symbol, "BUY", 10, new BigDecimal("100.00"), "idem-1", Instant.now());
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
            "trade-api", 1, objectMapper.valueToTree(payload));

        ConsumerRecord<String, Envelope> record =
            new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        InstrumentRow instrument = new InstrumentRow(symbol, "ACME Corp", true, null);
        when(instrumentMapper.findBySymbol(symbol))
            .thenThrow(new CannotGetJdbcConnectionException("Connection pool exhausted"))
            .thenReturn(Optional.of(instrument));

        QuoteResponse quote = new QuoteResponse(symbol, new BigDecimal("100"), ask,
            new BigDecimal("99.95"), "USD", BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
            "open", false, Instant.now());
        when(quoteClient.getQuote(symbol)).thenReturn(quote);

        when(settlementService.settle(any(), any(), any()))
            .thenReturn(SettlementService.SettlementResult.success(FillDecision.FILL, ask, 10, ask));

        consumer.consume(record, ack, 0, 0L);

        verify(instrumentMapper, times(2)).findBySymbol(symbol);
        verify(deadLetterService, never()).sendToDLT(anyString(), any(), any());
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("Transient error dead-lettered after retry budget exhausted")
    void transientErrorDeadLetteredAfterBudgetExhausted() throws InterruptedException {
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

        when(quoteClient.getQuote(symbol))
            .thenThrow(new FauxnanceQuoteClient.ServiceUnreachable("Fauxnance always down"));

        consumer.consume(record, ack, 0, 0L);

        verify(quoteClient, times(3)).getQuote(symbol);
        verify(deadLetterService).sendToDLT(
            keyCaptor.capture(), envelopeCaptor.capture(), errorContextCaptor.capture());
        verify(ack).acknowledge();

        ErrorContext errorCtx = errorContextCaptor.getValue();
        assertThat(errorCtx.attemptCount()).isEqualTo(3);
        assertThat(errorCtx.category()).isEqualTo(ErrorCategory.QUOTE_FETCH_TRANSIENT);
        assertThat(errorCtx.failureReason()).contains("SERVICE_UNREACHABLE");
    }

    @Test
    @DisplayName("Poison message is dead-lettered and offset is advanced (no partition blocking)")
    void poisonMessageDoesNotBlockPartition() {
        Long accountId = 1L;
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
            "trade-api", 1, null);

        ConsumerRecord<String, Envelope> record =
            new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        consumer.consume(record, ack, 0, 0L);

        verify(deadLetterService).sendToDLT(anyString(), any(), any());
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("Replay of settled order does not retry or dead-letter")
    void replayOfSettledOrderNoRetryNoDLT() {
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

        QuoteResponse quote = new QuoteResponse(symbol, new BigDecimal("100"), new BigDecimal("100.05"),
            new BigDecimal("99.95"), "USD", BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
            "open", false, Instant.now());
        when(quoteClient.getQuote(symbol)).thenReturn(quote);

        when(settlementService.settle(any(), any(), any()))
            .thenReturn(SettlementService.SettlementResult.alreadySettled("FILLED"));

        consumer.consume(record, ack, 0, 0L);

        verify(kafkaTemplate, never()).send(anyString(), anyString(), any());
        verify(deadLetterService, never()).sendToDLT(anyString(), any(), any());
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("ErrorContext calculates exponential backoff correctly")
    void exponentialBackoffCalculation() {
        ErrorContext ctx1 = new ErrorContext(
            ErrorCategory.QUOTE_FETCH_TRANSIENT, true, 3,
            "TEST", "test", "Exception");
        ErrorContext ctx2 = ctx1.nextAttempt();
        ErrorContext ctx3 = ctx2.nextAttempt();

        assertThat(ctx1.calculateBackoffMs(100)).isEqualTo(100);
        assertThat(ctx2.calculateBackoffMs(100)).isEqualTo(200);
        assertThat(ctx3.calculateBackoffMs(100)).isEqualTo(400);
    }

    @Test
    @DisplayName("RetryHandler.shouldRetry respects budget")
    void retryHandlerRespectsBudget() {
        ErrorContext ctx1 = new ErrorContext(
            ErrorCategory.QUOTE_FETCH_TRANSIENT, true, 3,
            "TEST", "test", "Exception", Instant.now(), 1);
        ErrorContext ctx2 = ctx1.nextAttempt();
        ErrorContext ctx3 = ctx2.nextAttempt();

        assertThat(retryHandler.shouldRetry(ctx1)).isTrue();
        assertThat(retryHandler.shouldRetry(ctx2)).isTrue();
        assertThat(retryHandler.shouldRetry(ctx3)).isFalse();
    }
}
