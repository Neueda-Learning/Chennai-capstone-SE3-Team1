package com.team1.executor.model;

import java.time.LocalDateTime;

public record InstrumentRow(
        String instrumentId,
        String instrumentName,
        Boolean active,
        LocalDateTime updatedOn
) {

    public boolean isTradable() {
        return Boolean.TRUE.equals(active);
    }
}