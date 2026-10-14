package com.team1.trading.api.chat;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The textbook indicators, over series ordered oldest first. Plain arithmetic with no market opinion in
 * it; Outlook decides what the readings mean. Anything that needs more history than it was given
 * returns null rather than a guess.
 */
public final class TechnicalIndicators {

    public record Macd(double line, double signal, double histogram, double previousHistogram) {
    }

    public record Bollinger(double middle, double upper, double lower, double percentB) {
    }

    private TechnicalIndicators() {
    }

    /** Daily simple returns: close[i] / close[i-1] - 1. */
    public static double[] returns(List<Double> closes) {
        double[] out = new double[Math.max(0, closes.size() - 1)];
        for (int i = 1; i < closes.size(); i++) {
            out[i - 1] = closes.get(i) / closes.get(i - 1) - 1;
        }
        return out;
    }

    /** Exponential moving average seeded with the simple average of the first {@code period} values. */
    public static double[] ema(double[] values, int period) {
        double[] out = new double[values.length];
        Arrays.fill(out, Double.NaN);
        if (values.length < period) {
            return out;
        }
        double seed = 0;
        for (int i = 0; i < period; i++) {
            seed += values[i];
        }
        out[period - 1] = seed / period;
        double k = 2.0 / (period + 1);
        for (int i = period; i < values.length; i++) {
            out[i] = values[i] * k + out[i - 1] * (1 - k);
        }
        return out;
    }

    /** MACD(12, 26, 9) at the last two closes, or null with fewer than 35 closes. */
    public static Macd macd(List<Double> closes) {
        int n = closes.size();
        if (n < 26 + 9) {
            return null;
        }
        double[] values = closes.stream().mapToDouble(Double::doubleValue).toArray();
        double[] fast = ema(values, 12);
        double[] slow = ema(values, 26);
        double[] line = new double[n - 25];
        for (int i = 25; i < n; i++) {
            line[i - 25] = fast[i] - slow[i];
        }
        double[] signal = ema(line, 9);
        int last = line.length - 1;
        return new Macd(line[last], signal[last], line[last] - signal[last], line[last - 1] - signal[last - 1]);
    }

    /** Bollinger bands over the last {@code period} closes, or null with fewer. %B is 0 at the lower band, 1 at the upper. */
    public static Bollinger bollinger(List<Double> closes, int period, double widthInDeviations) {
        int n = closes.size();
        if (n < period) {
            return null;
        }
        double sum = 0;
        for (int i = n - period; i < n; i++) {
            sum += closes.get(i);
        }
        double mean = sum / period;
        double variance = 0;
        for (int i = n - period; i < n; i++) {
            variance += (closes.get(i) - mean) * (closes.get(i) - mean);
        }
        double deviation = Math.sqrt(variance / period);
        double upper = mean + widthInDeviations * deviation;
        double lower = mean - widthInDeviations * deviation;
        double percentB = upper == lower ? 0.5 : (closes.get(n - 1) - lower) / (upper - lower);
        return new Bollinger(mean, upper, lower, percentB);
    }

    /** Wilder's average true range over {@code period}, as a percentage of the last close; null if too short. */
    public static Double atrPercent(List<Double> highs, List<Double> lows, List<Double> closes, int period) {
        int n = closes.size();
        if (n < period + 1 || highs.size() != n || lows.size() != n) {
            return null;
        }
        double[] trueRange = new double[n - 1];
        for (int i = 1; i < n; i++) {
            double previous = closes.get(i - 1);
            trueRange[i - 1] = Math.max(highs.get(i) - lows.get(i),
                    Math.max(Math.abs(highs.get(i) - previous), Math.abs(lows.get(i) - previous)));
        }
        double atr = 0;
        for (int i = 0; i < period; i++) {
            atr += trueRange[i];
        }
        atr /= period;
        for (int i = period; i < trueRange.length; i++) {
            atr = (atr * (period - 1) + trueRange[i]) / period;
        }
        return round(atr / closes.get(n - 1) * 100);
    }

    /** Percentile (0 to 100) of the values by linear interpolation between order statistics. */
    public static double percentile(double[] values, double percent) {
        if (values.length == 0) {
            throw new IllegalArgumentException("no values");
        }
        double[] sorted = values.clone();
        Arrays.sort(sorted);
        double rank = percent / 100.0 * (sorted.length - 1);
        int low = (int) Math.floor(rank);
        int high = (int) Math.ceil(rank);
        return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
    }

    /** Sample standard deviation, or 0 for fewer than two values. */
    public static double standardDeviation(double[] values) {
        if (values.length < 2) {
            return 0;
        }
        double mean = Arrays.stream(values).average().orElse(0);
        double sum = 0;
        for (double v : values) {
            sum += (v - mean) * (v - mean);
        }
        return Math.sqrt(sum / (values.length - 1));
    }

    /** Overlapping {@code days}-day returns: close[i] / close[i - days] - 1. */
    public static double[] horizonReturns(List<Double> closes, int days) {
        List<Double> out = new ArrayList<>();
        for (int i = days; i < closes.size(); i++) {
            out.add(closes.get(i) / closes.get(i - days) - 1);
        }
        return out.stream().mapToDouble(Double::doubleValue).toArray();
    }

    static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
