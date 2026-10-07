package com.team1.trading.domain.entity.types;

/**
 * What a conditional order waits for before it is released to the executor.
 *
 * PRICE_AT_OR_ABOVE / PRICE_AT_OR_BELOW   the latest price reaches triggerPrice.
 * MA_CROSS_ABOVE / MA_CROSS_BELOW         the shortWindow-quote average crosses the longWindow-quote average;
 *                                         a shortWindow of 1 is the price itself crossing its average.
 * BOLLINGER_BELOW_LOWER / ..._ABOVE_UPPER the price moves outside the band of the last longWindow quotes,
 *                                         mean plus or minus bandWidth standard deviations.
 */
public enum ConditionType {
    PRICE_AT_OR_ABOVE,
    PRICE_AT_OR_BELOW,
    MA_CROSS_ABOVE,
    MA_CROSS_BELOW,
    BOLLINGER_BELOW_LOWER,
    BOLLINGER_ABOVE_UPPER;

    public boolean isPriceLevel() {
        return this == PRICE_AT_OR_ABOVE || this == PRICE_AT_OR_BELOW;
    }

    public boolean isCrossover() {
        return this == MA_CROSS_ABOVE || this == MA_CROSS_BELOW;
    }

    public boolean isBand() {
        return this == BOLLINGER_BELOW_LOWER || this == BOLLINGER_ABOVE_UPPER;
    }
}
