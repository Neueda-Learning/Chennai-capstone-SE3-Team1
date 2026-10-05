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

    @KafkaListener(topics = "orders", groupId = "trade-executor", containerFactory = "kafkaListenerContainerFactory")
    public void consume(ConsumerRecord<String, Envelope> record,
            Acknowledgment ack,
            @Header("kafka_receivedPartitionId") int partition,
            @Header("kafka_offset") long offset) {

        String key = record.key();
        Envelope envelope = record.value();

        log.debug("Received message on partition {}, offset {}, key {}", partition, offset, key);

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

        ErrorContext errorContext = null;

        while (true) {
            try {
                processMessage(payload, envelope);
                ack.acknowledge();
                log.info("Successfully processed order {} on attempt {}",
                        payload.orderId(), errorContext != null ? errorContext.attemptCount() : 1);
                return;

            } catch (Exception e) {
                if (errorContext == null) {
                    errorContext = errorClassifier.classify(e, "processing OrderPlaced message");

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
                    log.debug("Retry attempt {} received exception: {}", errorContext.attemptCount() + 1, e.getMessage());
                }

                log.warn("Error processing order {} (attempt {}): {} - {}",
                        payload.orderId(), errorContext.attemptCount(),
                        errorContext.failureReason(), errorContext.failureDetails());

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

                if (retryHandler.shouldRetry(errorContext)) {
                    log.info("Retryable error detected, sleeping before retry attempt {}",
                            errorContext.attemptCount() + 1);
                    try {
                        retryHandler.sleepBeforeRetry(errorContext);
                        errorContext = errorContext.nextAttempt();
                        continue;

                    } catch (InterruptedException ie) {
                        log.error("Retry sleep interrupted for order {}", payload.orderId(), ie);
                        Thread.currentThread().interrupt();
                        break;
                    }
                }

                log.warn("Retry budget exhausted for order {} after {} attempts. Dead-lettering.",
                        payload.orderId(), errorContext.attemptCount());
                break;
            }
        }

        try {
            deadLetterService.sendToDLT(key, envelope, errorContext);
        } catch (Exception dltError) {
            log.error("Critical: Failed to send message to DLT after retries. This message is lost. " +
                    "Order: {}, Error: {}", payload.orderId(), dltError.getMessage());
        }

        ack.acknowledge();
    }

    private void processMessage(OrderPlacedPayload payload, Envelope envelope) throws Exception {
        var instrumentOpt = instrumentMapper.findBySymbol(payload.symbol());
        if (instrumentOpt.isEmpty()) {
            throw new IllegalArgumentException("INSTRUMENT_NOT_FOUND: Symbol " + payload.symbol());
        }
        InstrumentRow instrument = instrumentOpt.get();
        if (!instrument.isTradable()) {
            throw new IllegalArgumentException("INSTRUMENT_NOT_TRADABLE: Symbol " + payload.symbol());
        }

        QuoteResponse quote = quoteClient.getQuote(payload.symbol());

        Order order = toDomainOrder(payload);
        FillRuleResult fillResult = FillRule.evaluate(order, quote);

        var settlementResult = settlementService.settle(order, fillResult,
                new SettlementService.QuoteSnapshot(quote.bid(), quote.ask()));

        if (!settlementResult.success()) {
            String reason = settlementResult.reason();
            log.info("Settlement failed for order {}: {}", payload.orderId(), reason);

            if (reason.startsWith("ALREADY_SETTLED")) {
                log.info("Message is a replay; order already settled with status {}. Not publishing duplicate event.",
                        reason.substring("ALREADY_SETTLED_".length()));
                return;
            }

            throw new IllegalArgumentException(reason);
        }

        if (settlementResult.decision() == com.team1.executor.rule.FillDecision.FILL) {
            publishFilled(payload, envelope.eventId(), settlementResult.executedPrice(), quote,
                    settlementResult.quantityAfter(), settlementResult.averageCostAfter());
        } else {
            publishRejected(payload, envelope.eventId(), fillResult.reason(), quote);
        }
    }

    private <T> T deserializePayload(JsonNode payloadNode, Class<T> clazz) throws Exception {
        return objectMapper.treeToValue(payloadNode, clazz);
    }

    private Order toDomainOrder(OrderPlacedPayload payload) {
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

    private BigDecimal calculateCashDelta(OrderPlacedPayload payload, BigDecimal executedPrice) {
        BigDecimal quantity = BigDecimal.valueOf(payload.quantity());
        BigDecimal price = executedPrice != null ? executedPrice : payload.price();
        BigDecimal tradeValue = quantity.multiply(price).setScale(2, RoundingMode.HALF_UP);
        return "BUY".equals(payload.side()) ? tradeValue.negate() : tradeValue;
    }
}