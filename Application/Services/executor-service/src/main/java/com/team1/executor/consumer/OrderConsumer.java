package com.team1.executor.consumer;

import com.team1.eventbus.Envelope;
import com.team1.executor.error.DeadLetterService;
import com.team1.executor.error.ErrorCategory;
import com.team1.executor.error.ErrorClassifier;
import com.team1.executor.error.ErrorContext;
import com.team1.executor.error.RetryHandler;
import com.team1.executor.mapper.InstrumentMapper;
import com.team1.executor.model.InstrumentRow;
import com.team1.executor.model.OrderPlacedPayload;
import com.team1.executor.model.QuoteResponse;
import com.team1.executor.model.TradeEventPayload;
import com.team1.executor.quote.FauxnanceQuoteClient;
import com.team1.executor.rule.FillRule;
import com.team1.executor.rule.FillRuleResult;
import com.team1.executor.settlement.SettlementService;
import com.team1.trading.domain.entity.Order;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.UUID;

/**
 * Consumes ORDER_PLACED messages from Kafka orders topic.
 * 
 * Processing pipeline:
 * 1. Deserialize Envelope → OrderPlacedPayload
 * 2. Validate instrument (must exist and be tradable)
 * 3. Fetch quote from Fauxnance
 * 4. Apply fill rules
 * 5. Settle order (atomically update order status, account balance, positions)
 * 6. Publish ORDER_FILLED or ORDER_REJECTED
 * 7. Acknowledge offset
 * 
 * Error handling:
 * - Poison messages (malformed JSON, missing fields) → dead-letter immediately
 * - Transient failures (quote timeout, DB connection lost) → retry with
 * exponential backoff
 * - Permanent Fauxnance failures (quota, bad symbol) → reject order without
 * retry/DLT
 * 
 * At-least-once guarantee: already-settled detection (order status != NEW)
 * prevents re-processing.
 * 
 * Dead-letter messages are published to orders.DLT with failure metadata as
 * Kafka headers.
 */
@Component
public class OrderConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderConsumer.class);
    private static final String TRADE_EVENTS_TOPIC = "trade-events";

    private final InstrumentMapper instrumentMapper;
    private final FauxnanceQuoteClient quoteClient;
    private final SettlementService settlementService;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final ObjectMapper objectMapper;
    private final ErrorClassifier errorClassifier;
    private final RetryHandler retryHandler;
    private final DeadLetterService deadLetterService;

    public OrderConsumer(InstrumentMapper instrumentMapper,
            FauxnanceQuoteClient quoteClient,
            SettlementService settlementService,
            KafkaTemplate<String, Object> kafkaTemplate,
            ObjectMapper objectMapper,
            ErrorClassifier errorClassifier,
            RetryHandler retryHandler,
            DeadLetterService deadLetterService) {
        this.instrumentMapper = instrumentMapper;
        this.quoteClient = quoteClient;
        this.settlementService = settlementService;
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
        this.errorClassifier = errorClassifier;
        this.retryHandler = retryHandler;
        this.deadLetterService = deadLetterService;
    }

    /**
     * Main Kafka listener: receives ORDER_PLACED messages.
     * 
     * Implements retry loop with exponential backoff:
     * - On poison message (malformed JSON, missing fields) → dead-letter
     * immediately
     * - On transient failure (network, DB, lock contention) → retry with backoff
     * - On permanent Fauxnance failure (quota, bad symbol) → reject order
     * 
     * Acknowledges offset after all retry attempts exhausted (success or
     * dead-letter).
     */
    @KafkaListener(topics = "orders", groupId = "trade-executor", containerFactory = "kafkaListenerContainerFactory")
    public void consume(ConsumerRecord<String, Envelope> record,
            Acknowledgment ack,
            @Header("kafka_receivedPartitionId") int partition,
            @Header("kafka_offset") long offset) {

        String key = record.key();
        Envelope envelope = record.value();

        log.debug("Received message on partition {}, offset {}, key {}", partition, offset, key);

        // === STAGE 1: Deserialize Envelope ===
        if (envelope == null) {
            log.warn("Null Envelope received for key {}, partition {}, offset {}. Skipping.", key, partition, offset);
            ack.acknowledge();
            return;
        }

        if (envelope.payload() == null) {
            log.warn("Null payload in Envelope for key {}, partition {}, offset {}. Sending to DLT.",
                    key, partition, offset);
            ErrorContext errorContext = new ErrorContext(
                    ErrorCategory.MALFORMED_MESSAGE, false, 0,
                    "NULL_PAYLOAD", "Envelope.payload() is null", "NullPointerException");
            deadLetterService.sendToDLT(key, envelope, errorContext);
            ack.acknowledge();
            return;
        }

        OrderPlacedPayload payload = null;
        try {
            payload = deserializePayload(envelope.payload(), OrderPlacedPayload.class);
        } catch (Exception e) {
            log.warn("Failed to deserialize payload for key {}: {}", key, e.getMessage());
            ErrorContext errorContext = errorClassifier.classify(e, "deserializing OrderPlacedPayload");
            deadLetterService.sendToDLT(key, envelope, errorContext);
            ack.acknowledge();
            return;
        }

        if (payload == null) {
            log.warn("Deserialized payload is null for key {}", key);
            ErrorContext errorContext = new ErrorContext(
                    ErrorCategory.MALFORMED_MESSAGE, false, 0,
                    "DESERIALIZATION_RETURNED_NULL", "ObjectMapper returned null", "NullPointerException");
            deadLetterService.sendToDLT(key, envelope, errorContext);
            ack.acknowledge();
            return;
        }

        log.info("Deserialized ORDER_PLACED: orderId={}, accountId={}, symbol={}, side={}, partition={}, offset={}",
                payload.orderId(), payload.accountId(), payload.symbol(), payload.side(), partition, offset);

        // === STAGE 2: Process with Retry Loop ===
        ErrorContext errorContext = null;

        while (true) {
            try {
                processMessage(payload, envelope);
                // Success: acknowledge and exit
                ack.acknowledge();
                log.info("Successfully processed order {} on attempt {}",
                        payload.orderId(), errorContext != null ? errorContext.attemptCount() : 1);
                return;

            } catch (Exception e) {
                // Only classify error on FIRST attempt, not on retries
                // This ensures attempt count persists across retry loop iterations
                if (errorContext == null) {
                    errorContext = errorClassifier.classify(e, "processing OrderPlaced message");

                    // Defensive check to avoid NPE if classifier returns null
                    if (errorContext == null) {
                        log.error("ErrorClassifier returned null for exception: {}", e.getMessage(), e);
                        errorContext = new ErrorContext(
                                ErrorCategory.UNKNOWN_ERROR,
                                false,
                                0,
                                "UNCLASSIFIED_ERROR",
                                e.getMessage() != null ? e.getMessage() : "Unknown error",
                                e.getClass().getName());
                    }
                } else {
                    // On retry, log the exception but reuse the same ErrorContext
                    log.debug("Retry attempt {} received exception: {}", errorContext.attemptCount() + 1, e.getMessage());
                }

                log.warn("Error processing order {} (attempt {}): {} - {}",
                        payload.orderId(), errorContext.attemptCount(),
                        errorContext.failureReason(), errorContext.failureDetails());

                // === HANDLE PERMANENT FAUXNANCE ERRORS ===
                // These should reject the order without retry or dead-letter
                if (errorContext.category() == ErrorCategory.QUOTE_FETCH_PERMANENT) {
                    log.warn("Permanent Fauxnance error (quota or bad request), rejecting order: {}",
                            errorContext.failureReason());
                    try {
                        publishRejected(payload, envelope.eventId(),
                                errorContext.failureReason(), null);
                    } catch (Exception publishError) {
                        log.error("Failed to publish rejection: {}", publishError.getMessage());
                    }
                    ack.acknowledge();
                    return;
                }

                // === HANDLE RETRYABLE ERRORS ===
                if (retryHandler.shouldRetry(errorContext)) {
                    log.info("Retryable error detected, sleeping before retry attempt {}",
                            errorContext.attemptCount() + 1);
                    try {
                        retryHandler.sleepBeforeRetry(errorContext);
                        errorContext = errorContext.nextAttempt();
                        // Loop continues to next retry attempt
                        continue;

                    } catch (InterruptedException ie) {
                        log.error("Retry sleep interrupted for order {}", payload.orderId(), ie);
                        Thread.currentThread().interrupt(); // Restore interrupt flag
                        break; // Exit retry loop, will dead-letter below
                    }
                }

                // === BUDGET EXHAUSTED: DEAD-LETTER ===
                log.warn("Retry budget exhausted for order {} after {} attempts. Dead-lettering.",
                        payload.orderId(), errorContext.attemptCount());
                break; // Exit retry loop, dead-letter below
            }
        }

        // === STAGE 3: Dead-Letter on Permanent Failure ===
        try {
            deadLetterService.sendToDLT(key, envelope, errorContext);
        } catch (Exception dltError) {
            log.error("Critical: Failed to send message to DLT after retries. This message is lost. " +
                    "Order: {}, Error: {}", payload.orderId(), dltError.getMessage());
            // Still acknowledge to advance the offset; message is lost but partition
            // continues
        }

        ack.acknowledge();
    }

    /**
     * Core message processing logic.
     * Throws exception if any step fails (will be caught by retry loop).
     * 
     * @param payload  The deserialized order payload
     * @param envelope The original Kafka envelope
     * @throws Exception if any step fails (will trigger retry or dead-letter)
     */
    private void processMessage(OrderPlacedPayload payload, Envelope envelope) throws Exception {
        // Step 1: Validate instrument
        var instrumentOpt = instrumentMapper.findBySymbol(payload.symbol());
        if (instrumentOpt.isEmpty()) {
            throw new IllegalArgumentException("INSTRUMENT_NOT_FOUND: Symbol " + payload.symbol());
        }
        InstrumentRow instrument = instrumentOpt.get();
        if (!instrument.isTradable()) {
            throw new IllegalArgumentException("INSTRUMENT_NOT_TRADABLE: Symbol " + payload.symbol());
        }

        // Step 2: Fetch quote (may timeout or fail transiently)
        QuoteResponse quote = quoteClient.getQuote(payload.symbol());

        // Step 3: Evaluate fill rules
        Order order = toDomainOrder(payload);
        FillRuleResult fillResult = FillRule.evaluate(order, quote);

        // Step 4: Settle (may fail with optimistic lock, connection errors, etc.)
        var settlementResult = settlementService.settle(order, fillResult,
                new SettlementService.QuoteSnapshot(quote.bid(), quote.ask()));

        // Step 5: Handle settlement result
        if (!settlementResult.success()) {
            String reason = settlementResult.reason();
            log.info("Settlement failed for order {}: {}", payload.orderId(), reason);

            // Check for already-settled (replay scenario)
            if (reason.startsWith("ALREADY_SETTLED")) {
                log.info("Message is a replay; order already settled with status {}. Not publishing duplicate event.",
                        reason.substring("ALREADY_SETTLED_".length()));
                // Don't publish duplicate event, don't throw exception
                // This is expected behavior, not an error
                return;
            }

            // For settlement failures (order not found, account not found, etc.),
            // throw exception so ErrorClassifier can categorize and dead-letter
            throw new IllegalArgumentException(reason);
        }

        // Step 6: Publish filled or rejected event
        if (settlementResult.decision() == com.team1.executor.rule.FillDecision.FILL) {
            publishFilled(payload, envelope.eventId(), settlementResult.executedPrice(), quote,
                    settlementResult.quantityAfter(), settlementResult.averageCostAfter());
        } else {
            publishRejected(payload, envelope.eventId(), fillResult.reason(), quote);
        }
    }

    /**
     * Deserializes a JsonNode into the target class.
     * 
     * @param payloadNode The JSON node to deserialize
     * @param clazz       The target class
     * @return The deserialized object, or null if deserialization fails
     * @throws Exception if deserialization fails (caller should classify)
     */
    private <T> T deserializePayload(JsonNode payloadNode, Class<T> clazz) throws Exception {
        return objectMapper.treeToValue(payloadNode, clazz);
    }

    /**
     * Converts OrderPlacedPayload to domain Order entity.
     * 
     * @param payload The payload from Kafka
     * @return Domain Order entity
     */
    private Order toDomainOrder(OrderPlacedPayload payload) {
        // accountId doubles as clientId in this schema (clients.client_id is the wallet).
        Order order = new Order(
                payload.accountId(),
                payload.accountId(),
                payload.symbol(),
                OrderType.HOLDING,
                OrderSide.valueOf(payload.side()),
                BigDecimal.valueOf(payload.quantity()),
                payload.price(),
                payload.idempotencyKey());
        order.setOrderId(payload.orderId());
        return order;
    }

    /**
     * Publishes ORDER_FILLED event to trade-events topic.
     * 
     * @param payload       The order payload
     * @param eventId       The original event ID (for tracing)
     * @param executedPrice The price at which order was filled
     * @param quote         The quote snapshot used for settlement
     */
    private void publishFilled(OrderPlacedPayload payload, String eventId, BigDecimal executedPrice,
            QuoteResponse quote, int quantityAfter, BigDecimal averageCostAfter) {
        BigDecimal cashDelta = calculateCashDelta(payload, executedPrice);
        TradeEventPayload event = new TradeEventPayload(
                payload.orderId(),
                payload.accountId(),
                payload.symbol(),
                payload.side(),
                payload.quantity(),
                payload.price(),
                executedPrice,
                "FILLED",
                null,
                cashDelta,
                quantityAfter,
                averageCostAfter,
                Instant.now());
        Envelope envelope = new Envelope(
                UUID.randomUUID().toString(),
                "ORDER_FILLED",
                Instant.now().toString(),
                "trade-executor",
                1,
                objectMapper.valueToTree(event));
        kafkaTemplate.send(TRADE_EVENTS_TOPIC, String.valueOf(payload.accountId()), envelope);
        log.info("Published ORDER_FILLED for order {}", payload.orderId());
    }

    /**
     * Publishes ORDER_REJECTED event to trade-events topic.
     *
     * @param payload    The order payload
     * @param eventId    The original event ID (for tracing)
     * @param reasonCode The rejection reason code
     * @param quote      The Fauxnance quote the rejection was decided against, or null when the
     *                   order was rejected before a quote was available (e.g. quota/API failure)
     */
    private void publishRejected(OrderPlacedPayload payload, String eventId, String reasonCode, QuoteResponse quote) {
        log.info("Order {} REJECTED [{}]: side={} symbol={} qty={} requestedPrice={} -- {}",
                payload.orderId(), reasonCode, payload.side(), payload.symbol(), payload.quantity(),
                payload.price(), describeRejection(payload.side(), payload.price(), quote));
        BigDecimal cashDelta = BigDecimal.ZERO;
        TradeEventPayload event = new TradeEventPayload(
                payload.orderId(),
                payload.accountId(),
                payload.symbol(),
                payload.side(),
                payload.quantity(),
                payload.price(),
                null,
                "REJECTED",
                reasonCode,
                cashDelta,
                0,
                BigDecimal.ZERO,
                Instant.now());
        Envelope envelope = new Envelope(
                UUID.randomUUID().toString(),
                "ORDER_REJECTED",
                Instant.now().toString(),
                "trade-executor",
                1,
                objectMapper.valueToTree(event));
        kafkaTemplate.send(TRADE_EVENTS_TOPIC, String.valueOf(payload.accountId()), envelope);
        log.info("Published ORDER_REJECTED for order {}: {}", payload.orderId(), reasonCode);
    }

    /**
     * Builds the human-readable price comparison that goes alongside a rejection log: the
     * requested/limit price against the Fauxnance bid/ask the fill rule actually compared it to,
     * so the log line proves why the order could not fill without needing to cross-reference code.
     *
     * @param side          BUY or SELL, as carried on the order payload
     * @param requestedPrice The client's limit price
     * @param quote         The Fauxnance quote used for the fill-rule decision, or null when no
     *                      quote was fetched (e.g. quota exhausted / Fauxnance API failure)
     */
    private String describeRejection(String side, BigDecimal requestedPrice, QuoteResponse quote) {
        if (quote == null || quote.bid() == null || quote.ask() == null) {
            return "no Fauxnance bid/ask available to compare against";
        }
        if ("BUY".equals(side)) {
            return String.format("requested price %s is below Fauxnance ask %s (a BUY needs requested >= ask to fill)",
                    requestedPrice, quote.ask());
        }
        return String.format("requested price %s is above Fauxnance bid %s (a SELL needs requested <= bid to fill)",
                requestedPrice, quote.bid());
    }

    /**
     * Calculates cash delta for balance update.
     * 
     * @param payload       The order payload
     * @param executedPrice The executed price
     * @return Negative for BUY (debit), positive for SELL (credit)
     */
    private BigDecimal calculateCashDelta(OrderPlacedPayload payload, BigDecimal executedPrice) {
        BigDecimal quantity = BigDecimal.valueOf(payload.quantity());
        BigDecimal price = executedPrice != null ? executedPrice : payload.price();
        BigDecimal tradeValue = quantity.multiply(price).setScale(2, RoundingMode.HALF_UP);
        return "BUY".equals(payload.side()) ? tradeValue.negate() : tradeValue;
    }
}