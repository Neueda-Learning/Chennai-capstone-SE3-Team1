package com.team1.trading.api.notifications;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

public record AlertNotification(
        UUID deliveryId,
        long accountId,
        String symbol,
        BigDecimal threshold,
        Direction direction,
        BigDecimal observedPrice,
        OffsetDateTime observedAt
) {
    public AlertNotification {
        if (deliveryId == null) throw new IllegalArgumentException("deliveryId");
        if (symbol == null || symbol.isBlank()) throw new IllegalArgumentException("symbol");
        if (threshold == null || observedPrice == null) throw new IllegalArgumentException("price");
        if (direction == null) throw new IllegalArgumentException("direction");
        if (observedAt == null) throw new IllegalArgumentException("observedAt");
    }
}
