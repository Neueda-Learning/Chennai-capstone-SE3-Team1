package com.team1.trading.api.chat;

import java.util.List;

/**
 * Plain statistics over a series of closing prices, oldest first. These are computed here rather than
 * by the model: a language model is unreliable at arithmetic, and the numbers it quotes should be ones
 * the code can be tested against.
 */
public final class PriceStats {

    static final int TRADING_DAYS_PER_YEAR = 252;
    static final int RSI_PERIOD = 14;

    /** Any field that needs more history than the series has is null. */
    public record Summary(
            int observations,
            double lastClose,
            double returnPct,
            double high,
            double low,
            Double sma20,
            Double sma50,
            Double rsi14,
            Double annualisedVolatilityPct,
            double maxDrawdownPct) {
    }

    private PriceStats() {
    }

    public static Summary summarise(List<Double> closes) {
        if (closes == null || closes.size() < 2) {
            throw new IllegalArgumentException("at least two closes are needed");
        }
        double first = closes.get(0);
        double last = closes.get(closes.size() - 1);
        double high = Double.NEGATIVE_INFINITY;
        double low = Double.POSITIVE_INFINITY;
        for (double close : closes) {
            high = Math.max(high, close);
            low = Math.min(low, close);
        }
        return new Summary(
                closes.size(),
                round(last),
                round((last / first - 1) * 100),
                round(high),
                round(low),
                sma(closes, 20),
                sma(closes, 50),
                rsi(closes, RSI_PERIOD),
                annualisedVolatilityPct(closes),
                round(maxDrawdownPct(closes)));
    }

    /** Simple moving average of the last {@code period} closes, or null if there are fewer. */
    static Double sma(List<Double> closes, int period) {
        if (closes.size() < period) {
            return null;
        }
        double sum = 0;
        for (int i = closes.size() - period; i < closes.size(); i++) {
            sum += closes.get(i);
        }
        return round(sum / period);
    }

    /** Wilder's relative strength index, 0 to 100, or null with fewer than period + 1 closes. */
    static Double rsi(List<Double> closes, int period) {
        if (closes.size() < period + 1) {
            return null;
        }
        double gain = 0;
        double loss = 0;
        for (int i = 1; i <= period; i++) {
            double change = closes.get(i) - closes.get(i - 1);
            if (change >= 0) {
                gain += change;
            } else {
                loss -= change;
            }
        }
        double averageGain = gain / period;
        double averageLoss = loss / period;
        for (int i = period + 1; i < closes.size(); i++) {
            double change = closes.get(i) - closes.get(i - 1);
            averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
            averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
        }
        if (averageLoss == 0) {
            return averageGain == 0 ? 50.0 : 100.0;
        }
        double relativeStrength = averageGain / averageLoss;
        return round(100 - 100 / (1 + relativeStrength));
    }

    /** Standard deviation of daily simple returns, scaled to a year, as a percentage. Null under 3 closes. */
    static Double annualisedVolatilityPct(List<Double> closes) {
        if (closes.size() < 3) {
            return null;
        }
        int n = closes.size() - 1;
        double[] returns = new double[n];
        double mean = 0;
        for (int i = 0; i < n; i++) {
            returns[i] = closes.get(i + 1) / closes.get(i) - 1;
            mean += returns[i];
        }
        mean /= n;
        double variance = 0;
        for (double r : returns) {
            variance += (r - mean) * (r - mean);
        }
        variance /= (n - 1);
        return round(Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100);
    }

    /** The largest peak-to-trough fall in the series, as a negative percentage (0 if it never fell). */
    static double maxDrawdownPct(List<Double> closes) {
        double peak = closes.get(0);
        double worst = 0;
        for (double close : closes) {
            peak = Math.max(peak, close);
            worst = Math.min(worst, close / peak - 1);
        }
        return worst * 100;
    }

    static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
