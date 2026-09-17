package com.team1.trading.api.event;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.team1.trading.domain.entity.types.OrderSide;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

/**
 * Payload of the {@code ORDER_PLACED} event published to the {@code orders} Kafka topic when an
 * order is accepted, keyed by the account it belongs to.
 *
 * <p>The order is persisted at {@code NEW} before this event exists; the event is only published
 * after the transaction that wrote the order commits (see {@link KafkaOrderEventPublisher}). An
 * event for an order that rolled back can never be produced, and an order that committed but was
 * never published can be replayed from the order table, which is the recoverable failure model
 * Spring 7 mandates for the Trade Executor.
 *
 * <p>The record is the {@code orders} topic payload. The wire names follow
 * {@code contracts/kafka-topics.md} ({@code orderId} and {@code createdOn}, not the component
 * names), and {@link KafkaOrderEventPublisher} wraps the record in the shared five-field
 * {@code com.team1.eventbus.Envelope} before sending, so nothing on the wire bypasses the
 * envelope contract.
 *
 * @param orderUuid      the stored UUID of the order row, the key the executor uses to resolve it
 * @param accountId      the numeric account key the event is keyed by
 * @param symbol         instrument symbol (also the Fauxnance quote symbol)
 * @param side           BUY or SELL
 * @param quantity       whole units requested
 * @param price          the limit price submitted with the order; the executor prices with a live
 *                       quote, this is carried for the executor's own affordability decision
 * @param idempotencyKey the client's idempotency key, for replay correlation
 * @param createdOnUtc   when the order was placed, normalised to UTC for RFC 3339 wire format
 */
public record OrderPlacedEvent(
        @JsonProperty("orderId") String orderUuid,
        @JsonProperty("accountId") Long accountId,
        @JsonProperty("symbol") String symbol,
        @JsonProperty("side") OrderSide side,
        @JsonProperty("quantity") Integer quantity,
        @JsonProperty("price") BigDecimal price,
        @JsonProperty("idempotencyKey") String idempotencyKey,
        @JsonProperty("createdOn") Instant createdOnUtc) {

    public static final String EVENT_TYPE = "ORDER_PLACED";
    public static final String TOPIC = "orders";

    public static OrderPlacedEvent of(String orderUuid, Long accountId, String symbol, OrderSide side,
                                      Integer quantity, BigDecimal price, String idempotencyKey,
                                      LocalDateTime placedAt) {
        // The order row stores local date-time; the wire contract expects an absolute UTC instant.
        return new OrderPlacedEvent(orderUuid, accountId, symbol, side, quantity, price,
                idempotencyKey, placedAt.toInstant(ZoneOffset.UTC));
    }

    /** The Kafka record key: the account the order belongs to. */
    public String key() {
        return String.valueOf(accountId);
    }
}