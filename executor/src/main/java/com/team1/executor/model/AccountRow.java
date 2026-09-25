package com.team1.executor.model;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public record AccountRow(
        Long clientId,
        String name,
        LocalDateTime createdOn,
        String accountState,
        BigDecimal walletBalance,
        Integer version,
        LocalDateTime updatedOn
) {

    public boolean isActive() {
        return "ACTIVE".equals(accountState);
    }
}