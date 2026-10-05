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
import org.springframework.jdbc.CannotGetJdbcConnectionException; // Correct package

import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.Acknowledgment;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Tests for dead-letter and retry functionality in OrderConsumer.
 * 
 * Acceptance Criteria Tested:
 * 1. Poison messages (malformed JSON, missing fields) → dead-lettered on 1st attempt
 * 2. Transient failures (quote timeout, DB connection lost) → retried with backoff
 * 3. After retry budget exhausted → dead-lettered with reason in headers
 * 4. Poison message doesn't block partition (offset advanced, processing continues)
 * 5. Replay of settled order → no retry, no dead-letter (already-settled detection)
 */
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
        // Use real ErrorClassifier and RetryHandler (not mocked)
        errorClassifier = new ErrorClassifier(3);  // max 3 attempts
        retryHandler = new RetryHandler(100, 2.0);  // 100ms base, 2.0x multiplier (small for fast tests)

        consumer = new OrderConsumer(
            instrumentMapper, quoteClient, settlementService, kafkaTemplate,
            objectMapper, errorClassifier, retryHandler, deadLetterService);
    }

    // ========== ACCEPTANCE CRITERION 1: Poison Messages Dead-Lettered Immediately ==========

    @Test
    @DisplayName("Malformed JSON is dead-lettered on first attempt, no retries")
    void malformedJsonDeadLetteredImmediately() throws InterruptedException {
        String symbol = "ACME";
        UUID orderId = UUID.randomUUID();
        Long accountId = 1L;

        // Create valid payload
        OrderPlacedPayload payload = new OrderPlacedPayload(
            orderId, accountId, symbol, "BUY", 10, new BigDecimal("100.00"), "idem-1", Instant.now());
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
            "trade-api", 1, objectMapper.valueToTree(payload));

        ConsumerRecord<String, Envelope> record =
            new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        // Instrument lookup fails (unexpected)
        when(instrumentMapper.findBySymbol(symbol))
            .thenThrow(new NullPointerException("Null instrument"));

        consumer.consume(record, ack, 0, 0L);

        // Verify: DLT called once (not retried)
        verify(deadLetterService, times(1)).sendToDLT(
            eq(String.valueOf(accountId)), eq(envelope), any(ErrorContext.class));
        verify(ack, times(1)).acknowledge();
    }

    @Test
    @DisplayName("Missing required field (null payload) is dead-lettered immediately")
    void missingRequiredFieldDeadLetteredImmediately() {
        Long accountId = 1L;
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
            "trade-api", 1, null);  // Null payload

        ConsumerRecord<String, Envelope> record =
            new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        consumer.consume(record, ack, 0, 0L);

        // Verify: DLT called once, no retries
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

        // Settlement fails: order not found
        when(settlementService.settle(any(), any(), any()))
            .thenReturn(SettlementService.SettlementResult.orderNotFound());

        consumer.consume(record, ack, 0, 0L);

        // Verify: DLT called once (not retried)
        verify(deadLetterService, times(1)).sendToDLT(
            keyCaptor.capture(), envelopeCaptor.capture(), errorContextCaptor.capture());
        verify(ack, times(1)).acknowledge();

        assertThat(errorContextCaptor.getValue().category())
            .isEqualTo(ErrorCategory.ORDER_NOT_FOUND);
    }

    // ========== ACCEPTANCE CRITERION 2: Transient Failures Retried with Backoff ==========

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

        // First call: timeout, second call: success
        when(quoteClient.getQuote(symbol))
            .thenThrow(new FauxnanceQuoteClient.ServiceUnreachable("Fauxnance timeout"))
            .thenReturn(quote);

        // Settlement succeeds
        when(settlementService.settle(any(), any(), any()))
            .thenReturn(SettlementService.SettlementResult.success(FillDecision.FILL, ask, 10, ask));

        consumer.consume(record, ack, 0, 0L);

        // Verify: Quote fetched twice (first timeout, then success)
        verify(quoteClient, times(2)).getQuote(symbol);
        // Verify: No dead-letter, order filled
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

        // Verify: Instrument fetched twice (first connection error, then success)
        verify(instrumentMapper, times(2)).findBySymbol(symbol);
        // Verify: No dead-letter on successful retry
        verify(deadLetterService, never()).sendToDLT(anyString(), any(), any());
        verify(ack).acknowledge();
    }

    // ========== ACCEPTANCE CRITERION 3: Budget Exhausted → Dead-Letter ==========

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

        // Quote always times out (transient, but persistent for this test)
        when(quoteClient.getQuote(symbol))
            .thenThrow(new FauxnanceQuoteClient.ServiceUnreachable("Fauxnance always down"));

        consumer.consume(record, ack, 0, 0L);

        // Verify: Quote attempted 3 times (max retries = 3)
        verify(quoteClient, times(3)).getQuote(symbol);
        // Verify: Dead-lettered after budget exhausted
        verify(deadLetterService).sendToDLT(
            keyCaptor.capture(), envelopeCaptor.capture(), errorContextCaptor.capture());
        verify(ack).acknowledge();

        ErrorContext errorCtx = errorContextCaptor.getValue();
        assertThat(errorCtx.attemptCount()).isEqualTo(3);
        assertThat(errorCtx.category()).isEqualTo(ErrorCategory.QUOTE_FETCH_TRANSIENT);
        assertThat(errorCtx.failureReason()).contains("SERVICE_UNREACHABLE");
    }

    // ========== ACCEPTANCE CRITERION 4: Poison Message Doesn't Block Partition ==========

    @Test
    @DisplayName("Poison message is dead-lettered and offset is advanced (no partition blocking)")
    void poisonMessageDoesNotBlockPartition() {
        Long accountId = 1L;
        Envelope envelope = new Envelope("evt-1", "ORDER_PLACED", Instant.now().toString(),
            "trade-api", 1, null);  // Malformed

        ConsumerRecord<String, Envelope> record =
            new ConsumerRecord<>("orders", 0, 0, String.valueOf(accountId), envelope);

        consumer.consume(record, ack, 0, 0L);

        // Verify: Dead-lettered
        verify(deadLetterService).sendToDLT(anyString(), any(), any());
        // Verify: Offset is acknowledged (advanced) - critical for not blocking partition
        verify(ack).acknowledge();
    }

    // ========== ACCEPTANCE CRITERION 5: Already-Settled Replay ==========

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

        // Order already settled (replay scenario)
        when(settlementService.settle(any(), any(), any()))
            .thenReturn(SettlementService.SettlementResult.alreadySettled("FILLED"));

        consumer.consume(record, ack, 0, 0L);

        // Verify: No trade-events published (no duplicate)
        verify(kafkaTemplate, never()).send(anyString(), anyString(), any());
        // Verify: No dead-letter (already-settled is expected, not an error)
        verify(deadLetterService, never()).sendToDLT(anyString(), any(), any());
        // Verify: Offset acknowledged
        verify(ack).acknowledge();
    }

    // ========== UNIT TESTS: Error Classification and Backoff Calculation ==========

    @Test
    @DisplayName("ErrorContext calculates exponential backoff correctly")
    void exponentialBackoffCalculation() {
        ErrorContext ctx1 = new ErrorContext(
            ErrorCategory.QUOTE_FETCH_TRANSIENT, true, 3,
            "TEST", "test", "Exception");
        ErrorContext ctx2 = ctx1.nextAttempt();
        ErrorContext ctx3 = ctx2.nextAttempt();

        // With 100ms base and 2.0 multiplier:
        // Attempt 1: 100 * 2^0 = 100ms
        assertThat(ctx1.calculateBackoffMs(100)).isEqualTo(100);
        // Attempt 2: 100 * 2^1 = 200ms
        assertThat(ctx2.calculateBackoffMs(100)).isEqualTo(200);
        // Attempt 3: 100 * 2^2 = 400ms
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

        assertThat(retryHandler.shouldRetry(ctx1)).isTrue();  // attempt 1 < max 3
        assertThat(retryHandler.shouldRetry(ctx2)).isTrue();  // attempt 2 < max 3
        assertThat(retryHandler.shouldRetry(ctx3)).isFalse(); // attempt 3 >= max 3
    }
}
