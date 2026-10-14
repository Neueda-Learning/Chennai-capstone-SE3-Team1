package com.team1.trading.api.chat;

import java.util.ArrayList;
import java.util.List;

/**
 * A statistical reading of one stock from everything the app knows about it: its daily history, the
 * current quote, recent intraday ticks, and how the rest of the market is trading today.
 *
 * What this is, and is not. Each signal is a standard technical or statistical measure that describes how
 * the stock has been behaving. They are combined into a lean (bullish, bearish or neutral) and an
 * indicative chance of an up day. Short-horizon direction is close to a coin flip and simple indicators have
 * a weak record, so the chance is shrunk towards 50 and capped at 40 to 60, confidence is never above
 * moderate, and every result carries its caveats. The price ranges come from the stock's own history of
 * daily moves, so they say how far it has typically moved, not where it will go.
 */
public final class Outlook {

    static final int MIN_OBSERVATIONS = 30;
    static final int MIN_FOR_EMPIRICAL = 60;
    static final int MIN_FOR_CONDITIONAL = 15;
    static final int YEAR = 252;

    static final double LEAN_THRESHOLD = 0.2;
    static final double MAX_TILT_POINTS = 6.0;
    static final double MIN_CHANCE = 40;
    static final double MAX_CHANCE = 60;

    /**
     * @param closes  daily closes oldest first, completed days only (not today's partial candle)
     * @param price   the latest traded price
     * @param volumes daily volumes matching closes; null, or null entries, where unknown
     * @param ticks   recent intraday prices, oldest first (may be empty)
     * @param market  how the whole market is trading right now (may be null)
     */
    public record Input(
            List<Double> closes,
            List<Double> highs,
            List<Double> lows,
            List<Long> volumes,
            double price,
            Double changePercentToday,
            List<Double> ticks,
            MarketContext market) {
    }

    public record MarketContext(int advancers, int decliners, int total, Double averageChangePercent) {
    }

    public record Signal(String name, double score, String reading) {
    }

    public record Range(double low, double high) {
    }

    public record Levels(double low20Day, double high20Day, double low52Week, double high52Week, Double sma20,
                         Double sma50) {
    }

    public record Volatility(double dailySigmaPercent, Double recentSigmaPercent, String regime, Double atrPercent) {
    }

    public record BaseRates(int observations, double upDayFrequencyPercent, double meanDailyReturnPercent,
                            Integer similarRsiSamples, Double upDayAfterSimilarRsiPercent, String rsiBucket) {
    }

    public record Result(
            String lean,
            int upDayChancePercent,
            String confidence,
            double compositeScore,
            int signalsAgreeing,
            int signalsCounted,
            List<Signal> signals,
            Range nextDayTypical,
            Range nextDay90,
            Range fiveDay90,
            Levels levels,
            Volatility volatility,
            BaseRates baseRates,
            List<String> caveats) {
    }

    private Outlook() {
    }

    public static Result analyse(Input in) {
        List<Double> closes = in.closes();
        int n = closes.size();
        if (n < MIN_OBSERVATIONS) {
            throw new IllegalArgumentException("at least " + MIN_OBSERVATIONS + " days of history are needed");
        }
        double price = in.price();

        List<Signal> signals = new ArrayList<>();
        List<double[]> weighted = new ArrayList<>(); // {weight, score}
        add(signals, weighted, 0.30, trend(closes, price));
        add(signals, weighted, 0.25, momentum(closes, price));
        add(signals, weighted, 0.10, stretch(closes, price));
        add(signals, weighted, 0.05, rangePosition(closes, in.highs(), in.lows(), price));
        add(signals, weighted, 0.05, volume(closes, in.volumes()));
        add(signals, weighted, 0.15, market(in.market(), in.changePercentToday()));
        add(signals, weighted, 0.10, intraday(in.ticks()));

        double weightSum = weighted.stream().mapToDouble(w -> w[0]).sum();
        double composite = weighted.stream().mapToDouble(w -> w[0] * w[1]).sum() / weightSum;

        String lean = composite > LEAN_THRESHOLD ? "BULLISH" : composite < -LEAN_THRESHOLD ? "BEARISH" : "NEUTRAL";
        int counted = 0;
        int agreeing = 0;
        for (Signal s : signals) {
            if (Math.abs(s.score()) > 0.1) {
                counted++;
                if (Math.signum(s.score()) == Math.signum(composite)) {
                    agreeing++;
                }
            }
        }
        String confidence = Math.abs(composite) < LEAN_THRESHOLD || counted == 0 || agreeing / (double) counted < 0.6
                ? "LOW" : "MODERATE";

        double[] daily = TechnicalIndicators.returns(closes);
        BaseRates rates = baseRates(closes, daily);
        double chance = chance(rates, composite);

        double sigma = TechnicalIndicators.standardDeviation(daily);
        Range typical = new Range(round(price * (1 - sigma)), round(price * (1 + sigma)));
        Range nextDay90 = interval(price, daily, sigma, 1);
        Range fiveDay90 = interval(price, TechnicalIndicators.horizonReturns(closes, 5), sigma, 5);

        List<String> caveats = caveats(n, in, rates);
        return new Result(lean, (int) chance, confidence, round(composite), agreeing, counted, signals, typical,
                nextDay90, fiveDay90, levels(closes, in.highs(), in.lows()), volatility(in, daily, sigma), rates,
                caveats);
    }

    // ---- signals: each is -1 (clearly bearish) to +1 (clearly bullish), or null when it cannot be formed

    static Signal trend(List<Double> closes, double price) {
        Double sma20 = PriceStats.sma(closes, 20);
        Double sma50 = PriceStats.sma(closes, 50);
        double total = 0;
        double weight = 0;
        List<String> parts = new ArrayList<>();
        if (sma20 != null) {
            total += 0.4 * Math.signum(price - sma20);
            weight += 0.4;
            parts.add(String.format("price %s its 20-day average (%.1f%%)", price >= sma20 ? "above" : "below",
                    (price / sma20 - 1) * 100));
        }
        if (sma50 != null) {
            total += 0.3 * Math.signum(price - sma50);
            weight += 0.3;
            parts.add(String.format("%s the 50-day average (%.1f%%)", price >= sma50 ? "above" : "below",
                    (price / sma50 - 1) * 100));
        }
        if (sma20 != null && sma50 != null) {
            total += 0.3 * Math.signum(sma20 - sma50);
            weight += 0.3;
            parts.add("20-day average is " + (sma20 >= sma50 ? "above" : "below") + " the 50-day");
        }
        return weight == 0 ? null : new Signal("trend", round(total / weight), String.join("; ", parts));
    }

    static Signal momentum(List<Double> closes, double price) {
        double score = 0;
        double weight = 0;
        List<String> parts = new ArrayList<>();
        TechnicalIndicators.Macd macd = TechnicalIndicators.macd(closes);
        if (macd != null) {
            score += 0.6 * clamp(macd.histogram() / (0.005 * price), -1, 1);
            weight += 0.6;
            parts.add(String.format("MACD histogram %s and %s", macd.histogram() >= 0 ? "positive" : "negative",
                    macd.histogram() >= macd.previousHistogram() ? "rising" : "falling"));
        }
        if (closes.size() > 20) {
            double roc = price / closes.get(closes.size() - 21) - 1;
            score += 0.4 * clamp(roc / 0.08, -1, 1);
            weight += 0.4;
            parts.add(String.format("%.1f%% over 20 days", roc * 100));
        }
        return weight == 0 ? null : new Signal("momentum", round(score / weight), String.join("; ", parts));
    }

    /** Overbought or oversold readings argue against the trend: stretched moves tend to pause or reverse. */
    static Signal stretch(List<Double> closes, double price) {
        Double rsi = PriceStats.rsi(closes, PriceStats.RSI_PERIOD);
        TechnicalIndicators.Bollinger bands = TechnicalIndicators.bollinger(closes, 20, 2);
        if (rsi == null && bands == null) {
            return null;
        }
        double score = 0;
        List<String> parts = new ArrayList<>();
        if (rsi != null) {
            parts.add(String.format("RSI %.0f", rsi));
            if (rsi > 70) {
                score -= clamp((rsi - 70) / 20, 0, 1);
            } else if (rsi < 30) {
                score += clamp((30 - rsi) / 20, 0, 1);
            }
        }
        if (bands != null) {
            double b = bands.percentB();
            parts.add(String.format("%.0f%% of the way up the Bollinger band", b * 100));
            if (b > 1) {
                score -= clamp(b - 1, 0, 1);
            } else if (b < 0) {
                score += clamp(-b, 0, 1);
            }
        }
        return new Signal("stretch", round(clamp(score, -1, 1)), String.join("; ", parts));
    }

    static Signal rangePosition(List<Double> closes, List<Double> highs, List<Double> lows, double price) {
        int window = Math.min(YEAR, closes.size());
        double high = extreme(highs, closes, window, true);
        double low = extreme(lows, closes, window, false);
        if (high <= low) {
            return null;
        }
        double position = clamp((price - low) / (high - low), 0, 1);
        return new Signal("range", round((position - 0.5) * 0.6),
                String.format("%.0f%% of the way from the %d-day low to its high", position * 100, window));
    }

    /** Rising volume behind a move supports it; thinning volume behind a move is a weaker one. */
    static Signal volume(List<Double> closes, List<Long> volumes) {
        int n = closes.size();
        if (volumes == null || volumes.size() != n || n < 25) {
            return null;
        }
        double recent = averageVolume(volumes, n - 5, n);
        double baseline = averageVolume(volumes, n - 25, n - 5);
        if (recent <= 0 || baseline <= 0) {
            return null;
        }
        double ratio = recent / baseline;
        double fiveDayMove = closes.get(n - 1) / closes.get(n - 6) - 1;
        double score = Math.signum(fiveDayMove) * clamp(ratio - 1, -0.5, 0.5) * 2;
        return new Signal("volume", round(score), String.format("last 5 days' volume is %.0f%% of the prior 20-day average, "
                + "while the price moved %.1f%%", ratio * 100, fiveDayMove * 100));
    }

    /** The market's backdrop today and how this stock is doing against it. */
    static Signal market(MarketContext market, Double changePercentToday) {
        if (market == null || market.total() < 3) {
            return null;
        }
        int decided = market.advancers() + market.decliners();
        double breadth = decided == 0 ? 0 : (market.advancers() / (double) decided - 0.5) * 2;
        double score = 0.5 * breadth;
        String reading = String.format("%d of %d tracked stocks are up today", market.advancers(), market.total());
        if (changePercentToday != null && market.averageChangePercent() != null) {
            double relative = changePercentToday - market.averageChangePercent();
            score += 0.5 * clamp(relative / 2.0, -1, 1);
            reading += String.format("; this stock is %.1f points %s the market's average move", Math.abs(relative),
                    relative >= 0 ? "ahead of" : "behind");
        }
        return new Signal("market", round(clamp(score, -1, 1)), reading);
    }

    static Signal intraday(List<Double> ticks) {
        if (ticks == null || ticks.size() < 10) {
            return null;
        }
        double first = ticks.get(0);
        double last = ticks.get(ticks.size() - 1);
        double change = last / first - 1;
        return new Signal("intraday", round(clamp(change / 0.015, -1, 1)),
                String.format("%.2f%% across the last %d price readings", change * 100, ticks.size()));
    }

    // ---- base rates and ranges

    static BaseRates baseRates(List<Double> closes, double[] daily) {
        int window = Math.min(YEAR, daily.length);
        int offset = daily.length - window;
        int ups = 0;
        double sum = 0;
        for (int i = offset; i < daily.length; i++) {
            if (daily[i] > 0) {
                ups++;
            }
            sum += daily[i];
        }

        // What happened the day after, in the past, when RSI stood where it stands now.
        Double rsiNow = PriceStats.rsi(closes, PriceStats.RSI_PERIOD);
        Integer samples = null;
        Double afterSimilar = null;
        String bucket = null;
        if (rsiNow != null) {
            bucket = bucket(rsiNow);
            int matches = 0;
            int upsAfter = 0;
            for (int end = PriceStats.RSI_PERIOD + 1; end < closes.size(); end++) {
                Double rsi = PriceStats.rsi(closes.subList(0, end), PriceStats.RSI_PERIOD);
                if (rsi != null && bucket(rsi).equals(bucket)) {
                    matches++;
                    if (closes.get(end) > closes.get(end - 1)) {
                        upsAfter++;
                    }
                }
            }
            samples = matches;
            if (matches >= MIN_FOR_CONDITIONAL) {
                afterSimilar = round(100.0 * upsAfter / matches);
            }
        }
        return new BaseRates(window, round(100.0 * ups / window), round(100.0 * sum / window), samples, afterSimilar,
                bucket);
    }

    private static String bucket(double rsi) {
        return rsi < 35 ? "oversold (RSI under 35)" : rsi > 65 ? "overbought (RSI over 65)" : "neutral (RSI 35 to 65)";
    }

    /**
     * Indicative chance that the next close is higher: the stock's own up-day frequency, shrunk towards 50 by
     * ten imaginary days each way, nudged by the signals (at most six points) and by what followed similar RSI
     * readings (at most three), then kept within 40 to 60 and rounded to the nearest 5.
     */
    static double chance(BaseRates rates, double composite) {
        double shrunk = (rates.upDayFrequencyPercent() / 100 * rates.observations() + 10) / (rates.observations() + 20);
        double chance = shrunk * 100 + clamp(composite * MAX_TILT_POINTS, -MAX_TILT_POINTS, MAX_TILT_POINTS);
        if (rates.upDayAfterSimilarRsiPercent() != null && rates.similarRsiSamples() != null
                && rates.similarRsiSamples() >= 30) {
            chance += clamp((rates.upDayAfterSimilarRsiPercent() - shrunk * 100) * 0.3, -3, 3);
        }
        chance = clamp(chance, MIN_CHANCE, MAX_CHANCE);
        return Math.round(chance / 5.0) * 5.0;
    }

    /** A 90% range for the move over {@code days}: the stock's own 5th to 95th percentile, or a normal estimate. */
    static Range interval(double price, double[] returns, double dailySigma, int days) {
        if (returns.length >= MIN_FOR_EMPIRICAL) {
            return new Range(round(price * (1 + TechnicalIndicators.percentile(returns, 5))),
                    round(price * (1 + TechnicalIndicators.percentile(returns, 95))));
        }
        double spread = 1.645 * dailySigma * Math.sqrt(days);
        return new Range(round(price * (1 - spread)), round(price * (1 + spread)));
    }

    static Levels levels(List<Double> closes, List<Double> highs, List<Double> lows) {
        int n = closes.size();
        return new Levels(
                round(extreme(lows, closes, Math.min(20, n), false)),
                round(extreme(highs, closes, Math.min(20, n), true)),
                round(extreme(lows, closes, Math.min(YEAR, n), false)),
                round(extreme(highs, closes, Math.min(YEAR, n), true)),
                PriceStats.sma(closes, 20),
                PriceStats.sma(closes, 50));
    }

    static Volatility volatility(Input in, double[] daily, double sigma) {
        Double recent = null;
        String regime = "unknown";
        if (daily.length >= 60) {
            double[] last10 = java.util.Arrays.copyOfRange(daily, daily.length - 10, daily.length);
            double[] last60 = java.util.Arrays.copyOfRange(daily, daily.length - 60, daily.length);
            double recentSigma = TechnicalIndicators.standardDeviation(last10);
            double baseline = TechnicalIndicators.standardDeviation(last60);
            recent = round(recentSigma * 100);
            regime = baseline == 0 ? "unknown"
                    : recentSigma > baseline * 1.25 ? "expanding (swinging more than usual)"
                    : recentSigma < baseline * 0.75 ? "contracting (calmer than usual)" : "normal";
        }
        return new Volatility(round(sigma * 100), recent, regime,
                TechnicalIndicators.atrPercent(in.highs(), in.lows(), in.closes(), 14));
    }

    static List<String> caveats(int observations, Input in, BaseRates rates) {
        List<String> caveats = new ArrayList<>();
        caveats.add("This describes how the stock has behaved over " + observations + " trading days; it is not a "
                + "forecast. Next-day direction is close to a coin flip and these indicators have a weak track record.");
        caveats.add("It uses prices, volume and the market's moves today only. It cannot see news, results, "
                + "announcements or global events, any of which can override the picture.");
        if (observations < YEAR) {
            caveats.add("Only " + observations + " days of history are available, so the base rates are less reliable.");
        }
        if (in.volumes() == null) {
            caveats.add("No volume data was available, so volume was not part of this reading.");
        }
        if (rates.similarRsiSamples() != null && rates.similarRsiSamples() < MIN_FOR_CONDITIONAL) {
            caveats.add("Too few past days (" + rates.similarRsiSamples() + ") had a similar RSI to say what usually followed.");
        }
        return caveats;
    }

    // ---- helpers

    private static void add(List<Signal> signals, List<double[]> weighted, double weight, Signal signal) {
        if (signal != null) {
            signals.add(signal);
            weighted.add(new double[]{weight, signal.score()});
        }
    }

    private static double extreme(List<Double> preferred, List<Double> fallback, int window, boolean high) {
        List<Double> source = preferred != null && preferred.size() == fallback.size() ? preferred : fallback;
        double result = high ? Double.NEGATIVE_INFINITY : Double.POSITIVE_INFINITY;
        for (int i = source.size() - window; i < source.size(); i++) {
            double v = source.get(i) == null ? fallback.get(i) : source.get(i);
            result = high ? Math.max(result, v) : Math.min(result, v);
        }
        return result;
    }

    private static double averageVolume(List<Long> volumes, int from, int to) {
        double sum = 0;
        int count = 0;
        for (int i = from; i < to; i++) {
            if (volumes.get(i) != null) {
                sum += volumes.get(i);
                count++;
            }
        }
        return count == 0 ? 0 : sum / count;
    }

    private static double clamp(double v, double min, double max) {
        return Math.max(min, Math.min(max, v));
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
