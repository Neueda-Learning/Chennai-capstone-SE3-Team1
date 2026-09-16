package com.team1.executor.consumer;

import com.team1.eventbus.Envelope;
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

    public OrderConsumer(InstrumentMapper instrumentMapper,
                         FauxnanceQuoteClient quoteClient,
                         SettlementService settlementService,
                         KafkaTemplate<String, Object> kafkaTemplate,
                         ObjectMapper objectMapper) {
        this.instrumentMapper = instrumentMapper;
        this.quoteClient = quoteClient;
        this.settlementService = settlementService;
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(topics = "orders", groupId = "trade-executor",
            containerFactory = "kafkaListenerContainerFactory")
    public void consume(ConsumerRecord<String, Envelope> record,
                        Acknowledgment ack,
                        @Header("kafka_receivedPartitionId") int partition,
                        @Header("kafka_offset") long offset) {

        String key = record.key();
        Envelope envelope = record.value();

        if (envelope == null || envelope.payload() == null) {
            log.warn("Null payload received for key {}, partition {}, offset {}. Sending to DLT.", key, partition, offset);
            ack.acknowledge();
            return;
        }

        OrderPlacedPayload payload = deserializePayload(envelope.payload(), OrderPlacedPayload.class);
        if (payload == null) {
            log.warn("Failed to deserialize payload for key {}", key);
            ack.acknowledge();
            return;
        }

        log.info("Consumed ORDER_PLACED for orderId={}, accountId={}, symbol={}, side={}, partition={}, offset={}",
                payload.orderId(), payload.accountId(), payload.symbol(), payload.side(), partition, offset);

        try {
            var instrumentOpt = instrumentMapper.findBySymbol(payload.symbol());
            if (instrumentOpt.isEmpty() || !instrumentOpt.get().isTradable()) {
                String reason = instrumentOpt.isEmpty() ? "INSTRUMENT_NOT_FOUND" : "INSTRUMENT_NOT_TRADABLE";
                handleReject(payload, envelope.eventId(), reason, "Instrument not tradable");
                ack.acknowledge();
                return;
            }

            QuoteResponse quote;
            try {
                quote = quoteClient.getQuote(payload.symbol());
            } catch (FauxnanceQuoteClient.QuoteFetchException e) {
                log.warn("Quote fetch failed for {}: {}", payload.symbol(), e.getMessage());
                handleReject(payload, envelope.eventId(), "NO_PRICE_AVAILABLE", e.getMessage());
                ack.acknowledge();
                return;
            }

            Order order = toDomainOrder(payload);
            FillRuleResult fillResult = FillRule.evaluate(order, quote);
            var settlementResult = settlementService.settle(order, fillResult, new SettlementService.QuoteSnapshot(quote.bid(), quote.ask()));

            if (!settlementResult.success()) {
                log.info("Settlement did not succeed for order {}: {}", payload.orderId(), settlementResult.reason());
                if (!settlementResult.reason().startsWith("ALREADY_SETTLED")) {
                    handleReject(payload, envelope.eventId(), "SETTLEMENT_FAILED", settlementResult.reason());
                }
                ack.acknowledge();
                return;
            }

            if (settlementResult.decision() == com.team1.executor.rule.FillDecision.FILL) {
                publishFilled(payload, envelope.eventId(), settlementResult.executedPrice(), quote);
            } else {
                publishRejected(payload, envelope.eventId(), fillResult.reason());
            }

            ack.acknowledge();

        } catch (Exception e) {
            log.error("Error processing order {}: {}", payload.orderId(), e.getMessage(), e);
            throw e;
        }
    }

    private <T> T deserializePayload(JsonNode payloadNode, Class<T> clazz) {
        try {
            return objectMapper.treeToValue(payloadNode, clazz);
        } catch (Exception e) {
            log.error("Failed to deserialize payload: {}", e.getMessage());
            return null;
        }
    }

    private Order toDomainOrder(OrderPlacedPayload payload) {
        return new Order(
                payload.accountId(),
                payload.accountId(),
                payload.symbol(),
                OrderType.POSITION,
                OrderSide.valueOf(payload.side()),
                payload.price(),
                payload.price(),
                payload.idempotencyKey()
        );
    }

    private void handleReject(OrderPlacedPayload payload, String eventId, String reasonCode, String reason) {
        log.info("Rejecting order {}: {} - {}", payload.orderId(), reasonCode, reason);
        publishRejected(payload, eventId, reasonCode);
    }

    private void publishFilled(OrderPlacedPayload payload, String eventId, BigDecimal executedPrice, QuoteResponse quote) {
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
                0,
                BigDecimal.ZERO,
                Instant.now()
        );
        Envelope envelope = new Envelope(
                UUID.randomUUID().toString(),
                "ORDER_FILLED",
                Instant.now().toString(),
                "trade-executor",
                1,
                objectMapper.valueToTree(event)
        );
        kafkaTemplate.send(TRADE_EVENTS_TOPIC, String.valueOf(payload.accountId()), envelope);
        log.info("Published ORDER_FILLED for order {}", payload.orderId());
    }

    private void publishRejected(OrderPlacedPayload payload, String eventId, String reasonCode) {
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
                Instant.now()
        );
        Envelope envelope = new Envelope(
                UUID.randomUUID().toString(),
                "ORDER_REJECTED",
                Instant.now().toString(),
                "trade-executor",
                1,
                objectMapper.valueToTree(event)
        );
        kafkaTemplate.send(TRADE_EVENTS_TOPIC, String.valueOf(payload.accountId()), envelope);
        log.info("Published ORDER_REJECTED for order {}: {}", payload.orderId(), reasonCode);
    }

    private BigDecimal calculateCashDelta(OrderPlacedPayload payload, BigDecimal executedPrice) {
        BigDecimal quantity = BigDecimal.valueOf(payload.quantity());
        BigDecimal price = executedPrice != null ? executedPrice : payload.price();
        BigDecimal tradeValue = quantity.multiply(price).setScale(2, RoundingMode.HALF_UP);
        return "BUY".equals(payload.side()) ? tradeValue.negate() : tradeValue;
    }
}