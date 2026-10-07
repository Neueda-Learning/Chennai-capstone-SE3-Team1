package com.team1.trading.domain.entity.types;

public enum OrderStatus {
    NEW,
    FILLED,
    REJECTED,
    CANCELLED,
    /** A conditional order held in the order book until its condition is met; never sent to the executor. */
    PENDING,
}
