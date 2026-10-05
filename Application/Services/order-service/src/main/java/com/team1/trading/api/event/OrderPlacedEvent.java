package com.team1.trading.api.event;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.team1.trading.domain.entity.types.OrderSide;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

public record OrderPlacedEvent(
        @JsonProperty("orderId") String orderUuid,
        @JsonProperty("accountId") Long accountId,
        @JsonProperty("symbol") String symbol,
        @JsonProperty("side") OrderSide side,
        @JsonProperty("quantity") Integer quantity,
        @JsonProperty("price") BigDecimal price,
        @JsonProperty("idempotencyKey") String idempotencyKey,
        @JsonProperty("createdOn") Instant placedAt) {

    public static final String EVENT_TYPE = "ORDER_PLACED";
    public static final String TOPIC = "orders";

    public static OrderPlacedEvent of(String orderUuid, Long accountId, String symbol, OrderSide side,
                                      Integer quantity, BigDecimal price, String idempotencyKey,
                                      LocalDateTime placedAt) {
        return new OrderPlacedEvent(orderUuid, accountId, symbol, side, quantity, price,
                idempotencyKey, placedAt.atOffset(ZoneOffset.UTC).toInstant());
    }

    public String key() {
        return String.valueOf(accountId);
    }
}