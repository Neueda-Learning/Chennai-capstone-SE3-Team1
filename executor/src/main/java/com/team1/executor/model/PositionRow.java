package com.team1.executor.model;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public record PositionRow(
        Long holdingId,
        Long clientId,
        String instrumentId,
        Integer quantity,
        BigDecimal pricePerUnit,
        BigDecimal overallGains,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {}