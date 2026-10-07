package com.team1.trading.api.conditional;

import com.team1.trading.domain.entity.types.ConditionType;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** A condition in one plain sentence, for the order screen, the blotter and the assistant. */
public final class ConditionText {

    private ConditionText() {
    }

    public static String describe(ConditionType type, BigDecimal triggerPrice, Integer shortWindow,
                                  Integer longWindow, BigDecimal bandWidth) {
        return switch (type) {
            case PRICE_AT_OR_ABOVE -> "when the price reaches " + money(triggerPrice) + " or higher";
            case PRICE_AT_OR_BELOW -> "when the price falls to " + money(triggerPrice) + " or lower";
            case MA_CROSS_ABOVE -> "when " + fast(shortWindow) + " crosses above the " + longWindow + "-quote average";
            case MA_CROSS_BELOW -> "when " + fast(shortWindow) + " crosses below the " + longWindow + "-quote average";
            case BOLLINGER_BELOW_LOWER -> "when the price falls below the lower band (" + longWindow + " quotes, "
                    + width(bandWidth) + " standard deviations)";
            case BOLLINGER_ABOVE_UPPER -> "when the price rises above the upper band (" + longWindow + " quotes, "
                    + width(bandWidth) + " standard deviations)";
        };
    }

    /** The faster side of a crossover: the price itself for a window of 1, else its average. */
    static String fast(Integer shortWindow) {
        return shortWindow != null && shortWindow == 1 ? "the price" : "the " + shortWindow + "-quote average";
    }

    static String money(BigDecimal value) {
        return value == null ? "-" : value.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    private static String width(BigDecimal value) {
        return value == null ? "-" : value.stripTrailingZeros().toPlainString();
    }
}
