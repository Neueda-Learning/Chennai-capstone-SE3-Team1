package com.team1.trading.api.conditional;

import com.team1.trading.domain.entity.types.OrderSide;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** A conditional order still waiting, with what it waits for and when it was last checked. */
public record PendingOrderResponse(
        String orderId,
        String symbol,
        OrderSide side,
        int quantity,
        BigDecimal price,
        String conditionType,
        String condition,
        BigDecimal triggerPrice,
        Integer shortWindow,
        Integer longWindow,
        BigDecimal bandWidth,
        String lastState,
        LocalDateTime lastCheckedAt,
        LocalDateTime expiresAt,
        LocalDateTime createdOn) {
}
