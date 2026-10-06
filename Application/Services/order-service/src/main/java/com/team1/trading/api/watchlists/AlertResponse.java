package com.team1.trading.api.watchlists;

import com.team1.trading.api.notifications.Direction;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

public record AlertResponse(
        String id,
        String symbol,
        BigDecimal threshold,
        Direction direction,
        AlertState state,
        AlertDeliveryState deliveryState,
        OffsetDateTime firedAt,
        BigDecimal firedPrice,
        OffsetDateTime createdAt) {
}
