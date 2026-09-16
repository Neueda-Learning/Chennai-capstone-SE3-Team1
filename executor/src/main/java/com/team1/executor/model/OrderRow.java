package com.team1.executor.model;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

public record OrderRow(
        UUID orderId,
        Long clientId,
        Long accountId,
        String instrumentId,
        String orderType,
        String side,
        BigDecimal quantity,
        BigDecimal price,
        BigDecimal executedPrice,
        String status,
        String idempotencyKey,
        String externalOrderId,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        LocalDateTime executedOn
) {}