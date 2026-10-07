package com.team1.trading.api.dto;

import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderStatus;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * Where one order stands. condition is present while a conditional order is still in the book
 * (PENDING, or NEW after release until the executor settles it) and null otherwise.
 */
public record OrderStatusResponse(
        String orderId,
        Long accountId,
        String symbol,
        OrderSide side,
        Integer quantity,
        BigDecimal price,
        BigDecimal executedPrice,
        OrderStatus status,
        String reason,
        LocalDateTime createdOn,
        ConditionView condition) {

    public record ConditionView(
            String type,
            String description,
            BigDecimal triggerPrice,
            Integer shortWindow,
            Integer longWindow,
            BigDecimal bandWidth,
            String lastState,
            LocalDateTime expiresAt,
            LocalDateTime lastCheckedAt,
            LocalDateTime triggeredAt,
            String triggerReason) {
    }
}
