package com.team1.trading.api.chat;

import com.team1.trading.api.chat.Outlook.BaseRates;
import com.team1.trading.api.chat.Outlook.Input;
import com.team1.trading.api.chat.Outlook.MarketContext;
import com.team1.trading.api.chat.Outlook.Result;
import com.team1.trading.api.chat.Outlook.Signal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

class OutlookTest {

    // ---- synthetic markets

    /** A series that compounds {@code drift} a day with {@code noise} of random wobble; seeded, so repeatable. */
    private static List<Double> series(int days, double start, double drift, double noise, long seed) {
        Random random = new Random(seed);
        List<Double> closes = new ArrayList<>();
        double price = start;
        for (int i = 0; i < days; i++) {
            closes.add(price);
            price *= 1 + drift + noise * random.nextGaussian();
        }
        return closes;
    }

    private static Input input(List<Double> closes) {
        return input(closes, null, null, List.of());
    }

    private static Input input(List<Double> closes, List<Long> volumes, MarketContext market, List<Double> ticks) {
        List<Double> highs = closes.stream().map(c -> c * 1.01).toList();
        List<Double> lows = closes.stream().map(c -> c * 0.99).toList();
        double price = closes.get(closes.size() - 1);
        return new Input(closes, highs, lows, volumes, price, null, ticks, market);
    }

    private static Signal signal(Result result, String name) {
        return result.signals().stream().filter(s -> s.name().equals(name)).findFirst().orElse(null);
    }

    // ---- direction of the reading

    @Test
    @DisplayName("A steady climb reads bullish, with the trend and momentum signals positive")
    void uptrend() {
        Result result = Outlook.analyse(input(series(120, 100, 0.004, 0.004, 1)));

        assertThat(result.lean()).isEqualTo("BULLISH");
        assertThat(result.compositeScore()).isGreaterThan(Outlook.LEAN_THRESHOLD);
        assertThat(signal(result, "trend").score()).isGreaterThan(0.5);
        assertThat(signal(result, "momentum").score()).isGreaterThan(0);
        assertThat(result.signalsAgreeing()).isGreaterThan(0);
    }

    @Test
    @DisplayName("A steady fall reads bearish")
    void downtrend() {
        Result result = Outlook.analyse(input(series(120, 100, -0.004, 0.004, 2)));

        assertThat(result.lean()).isEqualTo("BEARISH");
        assertThat(result.compositeScore()).isLessThan(-Outlook.LEAN_THRESHOLD);
        assertThat(signal(result, "trend").score()).isLessThan(-0.5);
    }

    @Test
    @DisplayName("The indicative chance of an up day is higher for the climb than for the fall")
    void chanceFollowsTheReading() {
        Result up = Outlook.analyse(input(series(120, 100, 0.004, 0.004, 1)));
        Result down = Outlook.analyse(input(series(120, 100, -0.004, 0.004, 2)));

        assertThat(up.upDayChancePercent()).isGreaterThan(down.upDayChancePercent());
    }

    @Test
    @DisplayName("A stretched rally is marked down by the stretch signal: overbought moves tend to pause")
    void stretchedRally() {
        List<Double> closes = new ArrayList<>(series(80, 100, 0.0, 0.003, 3));
        for (int i = 0; i < 12; i++) {
            closes.add(closes.get(closes.size() - 1) * 1.03);
        }

        Result result = Outlook.analyse(input(closes));

        assertThat(signal(result, "stretch").score()).isLessThan(0);
        assertThat(signal(result, "stretch").reading()).contains("RSI");
    }

    @Test
    @DisplayName("A washed-out stock is marked up by the stretch signal: oversold moves tend to bounce")
    void washedOut() {
        List<Double> closes = new ArrayList<>(series(80, 100, 0.0, 0.003, 4));
        for (int i = 0; i < 12; i++) {
            closes.add(closes.get(closes.size() - 1) * 0.97);
        }

        assertThat(signal(Outlook.analyse(input(closes)), "stretch").score()).isGreaterThan(0);
    }

    // ---- the safety rules, over many markets

    @Test
    @DisplayName("Over many random markets: odds stay within 40 to 60 in steps of 5, confidence is never high, scores are bounded")
    void invariants() {
        for (long seed = 1; seed <= 60; seed++) {
            double drift = (seed % 7 - 3) * 0.002;
            Result result = Outlook.analyse(input(series(30 + (int) (seed * 4), 100, drift, 0.012, seed)));

            assertThat(result.upDayChancePercent()).as("seed %d", seed).isBetween(40, 60);
            assertThat(result.upDayChancePercent() % 5).as("seed %d", seed).isZero();
            assertThat(result.confidence()).as("seed %d", seed).isIn("LOW", "MODERATE");
            assertThat(result.compositeScore()).as("seed %d", seed).isBetween(-1.0, 1.0);
            final long which = seed;
            result.signals().forEach(s -> assertThat(s.score()).as("%s, seed %d", s.name(), which).isBetween(-1.0, 1.0));
            assertThat(result.nextDay90().low()).as("seed %d", seed).isLessThan(result.nextDay90().high());
            assertThat(result.fiveDay90().high() - result.fiveDay90().low())
                    .as("a week is wider than a day, seed %d", seed)
                    .isGreaterThan(result.nextDay90().high() - result.nextDay90().low());
            assertThat(result.caveats()).as("seed %d", seed).isNotEmpty();
        }
    }

    @Test
    @DisplayName("Confidence is low when there is no clear lean, and moderate only when signals mostly agree")
    void confidence() {
        Result clearUp = Outlook.analyse(input(series(120, 100, 0.004, 0.003, 5)));
        Result drifting = Outlook.analyse(input(series(120, 100, 0.0, 0.01, 6)));

        assertThat(clearUp.confidence()).isEqualTo("MODERATE");
        if (Math.abs(drifting.compositeScore()) < Outlook.LEAN_THRESHOLD) {
            assertThat(drifting.confidence()).isEqualTo("LOW");
            assertThat(drifting.lean()).isEqualTo("NEUTRAL");
        }
    }

    @Test
    @DisplayName("Every result says it is not a forecast and that news is invisible to it")
    void caveatsAlwaysPresent() {
        Result result = Outlook.analyse(input(series(120, 100, 0.002, 0.01, 7)));

        assertThat(String.join(" ", result.caveats())).contains("not a forecast").contains("cannot see news");
    }

    // ---- ranges and levels

    @Test
    @DisplayName("Ranges bracket today's price, and the typical band is the stock's own daily swing")
    void ranges() {
        List<Double> closes = series(200, 100, 0.0, 0.01, 8);
        Result result = Outlook.analyse(input(closes));
        double price = closes.get(closes.size() - 1);

        assertThat(result.nextDay90().low()).isLessThan(price);
        assertThat(result.nextDay90().high()).isGreaterThan(price);
        assertThat(result.nextDayTypical().high() / price - 1).isCloseTo(result.volatility().dailySigmaPercent() / 100, within(0.0005));
        assertThat(result.volatility().dailySigmaPercent()).isBetween(0.7, 1.4); // about the 1% wobble built in
    }

    @Test
    @DisplayName("With under 60 days the ranges fall back to a symmetric estimate from the daily swing, and say so")
    void shortHistoryUsesNormalEstimate() {
        List<Double> closes = series(40, 100, 0.0, 0.01, 9);
        Result result = Outlook.analyse(input(closes));
        double price = closes.get(closes.size() - 1);

        assertThat(result.nextDay90().high() - price).isCloseTo(price - result.nextDay90().low(), within(0.02));
        assertThat(String.join(" ", result.caveats())).contains("Only 40 days");
    }

    @Test
    @DisplayName("Key levels come from the recent highs and lows")
    void levels() {
        List<Double> closes = new ArrayList<>(series(60, 100, 0.0, 0.0, 10)); // flat at 100
        List<Double> highs = new ArrayList<>(closes.stream().map(c -> c + 1).toList());
        List<Double> lows = new ArrayList<>(closes.stream().map(c -> c - 1).toList());
        highs.set(58, 130.0);
        lows.set(55, 80.0);
        Input in = new Input(closes, highs, lows, null, 100, null, List.of(), null);

        Outlook.Levels levels = Outlook.analyse(in).levels();

        assertThat(levels.high20Day()).isEqualTo(130.0);
        assertThat(levels.low20Day()).isEqualTo(80.0);
        assertThat(levels.high52Week()).isEqualTo(130.0);
        assertThat(levels.sma20()).isEqualTo(100.0);
    }

    // ---- optional signals appear only when their data does

    @Test
    @DisplayName("Rising volume behind a rise supports it; thinning volume behind a rise does not")
    void volume() {
        List<Double> closes = series(60, 100, 0.004, 0.002, 11);
        List<Long> rising = new ArrayList<>();
        List<Long> thinning = new ArrayList<>();
        for (int i = 0; i < closes.size(); i++) {
            rising.add(i >= closes.size() - 5 ? 3_000_000L : 1_000_000L);
            thinning.add(i >= closes.size() - 5 ? 400_000L : 1_000_000L);
        }

        assertThat(signal(Outlook.analyse(input(closes, rising, null, List.of())), "volume").score()).isGreaterThan(0);
        assertThat(signal(Outlook.analyse(input(closes, thinning, null, List.of())), "volume").score()).isLessThan(0);
        Result none = Outlook.analyse(input(closes));
        assertThat(signal(none, "volume")).isNull();
        assertThat(String.join(" ", none.caveats())).contains("No volume data");
    }

    @Test
    @DisplayName("The market signal weighs how many stocks are up and whether this one is beating them")
    void market() {
        List<Double> closes = series(60, 100, 0.0, 0.01, 12);
        Input base = input(closes);
        Input strongMarket = new Input(base.closes(), base.highs(), base.lows(), null, base.price(), 2.0, List.of(),
                new MarketContext(8, 2, 10, 0.5));
        Input weakMarket = new Input(base.closes(), base.highs(), base.lows(), null, base.price(), -2.0, List.of(),
                new MarketContext(1, 9, 10, -1.0));

        assertThat(signal(Outlook.analyse(strongMarket), "market").score()).isGreaterThan(0.3);
        assertThat(signal(Outlook.analyse(strongMarket), "market").reading()).contains("8 of 10").contains("ahead of");
        assertThat(signal(Outlook.analyse(weakMarket), "market").score()).isLessThan(-0.3);
        assertThat(signal(Outlook.analyse(base), "market")).isNull();
        Input tiny = new Input(base.closes(), base.highs(), base.lows(), null, base.price(), 1.0, List.of(),
                new MarketContext(1, 1, 2, 0.0));
        assertThat(signal(Outlook.analyse(tiny), "market")).isNull(); // two stocks say nothing about a market
    }

    @Test
    @DisplayName("Intraday prices matter only when there are enough of them")
    void intraday() {
        List<Double> closes = series(60, 100, 0.0, 0.01, 13);
        List<Double> rising = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            rising.add(100.0 + i * 0.2);
        }

        assertThat(signal(Outlook.analyse(input(closes, null, null, rising)), "intraday").score()).isGreaterThan(0);
        assertThat(signal(Outlook.analyse(input(closes, null, null, rising.subList(0, 9))), "intraday")).isNull();
    }

    // ---- history needed

    @Test
    @DisplayName("Fewer than 30 days of history is refused rather than guessed at")
    void needsHistory() {
        assertThatThrownBy(() -> Outlook.analyse(input(series(29, 100, 0.0, 0.01, 14))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("30 days");
        assertThat(Outlook.analyse(input(series(30, 100, 0.0, 0.01, 14)))).isNotNull();
    }

    // ---- base rates, volatility, and the probability arithmetic

    @Test
    @DisplayName("An alternating series went up on exactly half its days")
    void upDayFrequency() {
        List<Double> closes = new ArrayList<>();
        for (int i = 0; i < 101; i++) { // 101 closes make 100 daily moves, 50 up and 50 down
            closes.add(i % 2 == 0 ? 100.0 : 101.0);
        }

        BaseRates rates = Outlook.analyse(input(closes)).baseRates();

        assertThat(rates.upDayFrequencyPercent()).isEqualTo(50.0);
        assertThat(rates.observations()).isEqualTo(100);
    }

    @Test
    @DisplayName("What followed past days with a similar RSI is reported only with enough such days")
    void conditionalBaseRate() {
        BaseRates long_ = Outlook.analyse(input(series(250, 100, 0.0, 0.01, 15))).baseRates();
        BaseRates short_ = Outlook.analyse(input(series(31, 100, 0.0, 0.01, 15))).baseRates();

        assertThat(long_.rsiBucket()).isNotNull();
        assertThat(long_.similarRsiSamples()).isGreaterThan(Outlook.MIN_FOR_CONDITIONAL);
        assertThat(long_.upDayAfterSimilarRsiPercent()).isBetween(0.0, 100.0);
        assertThat(short_.upDayAfterSimilarRsiPercent()).isNull();
    }

    @Test
    @DisplayName("Volatility is flagged as expanding when the last two weeks swing far more than usual")
    void volatilityRegime() {
        List<Double> calm = series(100, 100, 0.0, 0.003, 16);
        List<Double> closes = new ArrayList<>(calm);
        Random random = new Random(17);
        for (int i = 0; i < 10; i++) {
            closes.add(closes.get(closes.size() - 1) * (1 + 0.04 * random.nextGaussian()));
        }

        assertThat(Outlook.analyse(input(closes)).volatility().regime()).startsWith("expanding");
        assertThat(Outlook.analyse(input(calm)).volatility().regime()).doesNotStartWith("expanding");
    }

    @Test
    @DisplayName("The chance starts from the stock's own record, shrunk towards 50, then tilts by the signals")
    void chanceArithmetic() {
        BaseRates even = new BaseRates(250, 50.0, 0.0, null, null, "neutral");

        assertThat(Outlook.chance(even, 0.0)).isEqualTo(50.0);
        assertThat(Outlook.chance(even, 1.0)).isEqualTo(55.0);   // 50 + 6, to the nearest 5
        assertThat(Outlook.chance(even, -1.0)).isEqualTo(45.0);
        assertThat(Outlook.chance(even, 0.3)).isEqualTo(50.0);   // a mild lean does not move it
    }

    @Test
    @DisplayName("No record, however good, pushes the chance past 60 or below 40")
    void chanceIsCapped() {
        BaseRates alwaysUp = new BaseRates(250, 90.0, 1.0, 40, 95.0, "neutral");
        BaseRates alwaysDown = new BaseRates(250, 10.0, -1.0, 40, 5.0, "neutral");

        assertThat(Outlook.chance(alwaysUp, 1.0)).isEqualTo(60.0);
        assertThat(Outlook.chance(alwaysDown, -1.0)).isEqualTo(40.0);
    }

    @Test
    @DisplayName("A short record is shrunk harder towards 50 than a long one")
    void shrinkage() {
        BaseRates shortRecord = new BaseRates(20, 60.0, 0.1, null, null, "neutral");   // (12 + 10) / 40 = 55
        BaseRates longRecord = new BaseRates(250, 60.0, 0.1, null, null, "neutral");   // (150 + 10) / 270 = 59.3

        assertThat(Outlook.chance(shortRecord, 0.0)).isEqualTo(55.0);
        assertThat(Outlook.chance(longRecord, 0.0)).isEqualTo(60.0);
    }

    @Test
    @DisplayName("Ranges use the empirical 5th to 95th percentile with enough days, and a normal estimate otherwise")
    void intervalSelection() {
        double[] manyReturns = new double[100];
        for (int i = 0; i < 100; i++) {
            manyReturns[i] = (i - 50) / 1000.0; // -5.0% to +4.9%
        }

        Outlook.Range empirical = Outlook.interval(100, manyReturns, 0.0289, 1);
        Outlook.Range normal = Outlook.interval(100, new double[]{0.01, -0.01, 0.02}, 0.02, 1);

        assertThat(empirical.low()).isCloseTo(100 * (1 + TechnicalIndicators.percentile(manyReturns, 5)), within(0.01));
        assertThat(normal.low()).isCloseTo(100 * (1 - 1.645 * 0.02), within(0.01));
        assertThat(normal.high()).isCloseTo(100 * (1 + 1.645 * 0.02), within(0.01));
    }
}
