package com.team1.trading.api.conditional;

import com.team1.trading.domain.entity.types.ConditionType;

import java.math.BigDecimal;
import java.math.MathContext;
import java.util.List;

/**
 * Decides, from the recent market-data quotes, whether a conditional order's condition is met.
 *
 * Price conditions are levels: met whenever the latest price is at or past the trigger, including on the
 * first check after the order is placed.
 *
 * Crossover and band conditions are events. Each check records where things stand (ABOVE, BELOW or
 * INSIDE) on the order row, and the condition is met only when that state moves into the wanted one since
 * the previous check. The first check only records the state, so an average that is already above the
 * other when the order is placed waits for the next crossing rather than firing at once. Because the
 * state is stored, a crossing is caught however many quotes arrived between two checks.
 */
public final class ConditionRules {

    public static final String ABOVE = "ABOVE";
    public static final String BELOW = "BELOW";
    public static final String INSIDE = "INSIDE";

    private static final MathContext MC = MathContext.DECIMAL64;

    private ConditionRules() {
    }

    public record Condition(ConditionType type, BigDecimal triggerPrice, Integer shortWindow, Integer longWindow,
                            BigDecimal bandWidth) {
    }

    /**
     * @param met     the order should be released now
     * @param state   the state to store for the next check (null for price conditions)
     * @param ready   false when there were too few quotes to judge; nothing is decided
     * @param reason  what was seen, in a sentence, whether or not it was met
     */
    public record Evaluation(boolean met, String state, boolean ready, String reason) {
    }

    /** Quotes the condition needs, oldest first; the last one is the latest price. */
    public static int quotesNeeded(Condition condition) {
        return condition.type().isPriceLevel() ? 1 : condition.longWindow();
    }

    public static Evaluation evaluate(Condition condition, List<BigDecimal> prices, String previousState) {
        if (prices == null || prices.size() < quotesNeeded(condition)) {
            int have = prices == null ? 0 : prices.size();
            return new Evaluation(false, previousState, false,
                    "Waiting for quotes: " + have + " of " + quotesNeeded(condition) + " needed");
        }
        BigDecimal price = prices.get(prices.size() - 1);
        return switch (condition.type()) {
            case PRICE_AT_OR_ABOVE -> level(price.compareTo(condition.triggerPrice()) >= 0,
                    "Price " + ConditionText.money(price) + (price.compareTo(condition.triggerPrice()) >= 0
                            ? " reached " : " is below ") + ConditionText.money(condition.triggerPrice()));
            case PRICE_AT_OR_BELOW -> level(price.compareTo(condition.triggerPrice()) <= 0,
                    "Price " + ConditionText.money(price) + (price.compareTo(condition.triggerPrice()) <= 0
                            ? " fell to " : " is above ") + ConditionText.money(condition.triggerPrice()));
            case MA_CROSS_ABOVE, MA_CROSS_BELOW -> crossover(condition, prices, previousState);
            case BOLLINGER_BELOW_LOWER, BOLLINGER_ABOVE_UPPER -> band(condition, prices, previousState);
        };
    }

    private static Evaluation level(boolean met, String reason) {
        return new Evaluation(met, null, true, reason);
    }

    private static Evaluation crossover(Condition condition, List<BigDecimal> prices, String previousState) {
        BigDecimal shortAverage = average(prices, condition.shortWindow());
        BigDecimal longAverage = average(prices, condition.longWindow());
        int compared = shortAverage.compareTo(longAverage);
        String state = compared > 0 ? ABOVE : compared < 0 ? BELOW : (previousState == null ? INSIDE : previousState);
        String wanted = condition.type() == ConditionType.MA_CROSS_ABOVE ? ABOVE : BELOW;
        boolean met = previousState != null && !wanted.equals(previousState) && wanted.equals(state);
        String fast = condition.shortWindow() == 1 ? "Price" : condition.shortWindow() + "-quote average";
        String reason = fast + " " + ConditionText.money(shortAverage)
                + (met ? " crossed " + (ABOVE.equals(wanted) ? "above" : "below") : " is " + state.toLowerCase()
                + (INSIDE.equals(state) ? " level with" : ""))
                + " the " + condition.longWindow() + "-quote average " + ConditionText.money(longAverage);
        return new Evaluation(met, state, true, reason);
    }

    private static Evaluation band(Condition condition, List<BigDecimal> prices, String previousState) {
        List<BigDecimal> window = prices.subList(prices.size() - condition.longWindow(), prices.size());
        BigDecimal mean = average(window, window.size());
        BigDecimal variance = BigDecimal.ZERO;
        for (BigDecimal p : window) {
            BigDecimal d = p.subtract(mean);
            variance = variance.add(d.multiply(d));
        }
        BigDecimal spread = variance.divide(BigDecimal.valueOf(window.size()), MC).sqrt(MC)
                .multiply(condition.bandWidth());
        BigDecimal lower = mean.subtract(spread);
        BigDecimal upper = mean.add(spread);
        BigDecimal price = prices.get(prices.size() - 1);

        String state = price.compareTo(lower) < 0 ? BELOW : price.compareTo(upper) > 0 ? ABOVE : INSIDE;
        String wanted = condition.type() == ConditionType.BOLLINGER_BELOW_LOWER ? BELOW : ABOVE;
        boolean met = previousState != null && !wanted.equals(previousState) && wanted.equals(state);
        String reason = "Price " + ConditionText.money(price) + (met
                ? (BELOW.equals(wanted) ? " fell below the lower band " + ConditionText.money(lower)
                : " rose above the upper band " + ConditionText.money(upper))
                : " against a band of " + ConditionText.money(lower) + " to " + ConditionText.money(upper));
        return new Evaluation(met, state, true, reason);
    }

    static BigDecimal average(List<BigDecimal> prices, int window) {
        BigDecimal sum = BigDecimal.ZERO;
        for (BigDecimal p : prices.subList(prices.size() - window, prices.size())) {
            sum = sum.add(p);
        }
        return sum.divide(BigDecimal.valueOf(window), MC);
    }
}
