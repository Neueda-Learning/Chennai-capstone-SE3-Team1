package com.team1.trading.api.chat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

class TechnicalIndicatorsTest {

    private static List<Double> seq(int count, java.util.function.IntToDoubleFunction f) {
        return IntStream.range(0, count).mapToObj(i -> f.applyAsDouble(i)).toList();
    }

    @Test
    @DisplayName("Daily returns are the change from one close to the next")
    void returns() {
        double[] r = TechnicalIndicators.returns(List.of(100.0, 110.0, 99.0));

        assertThat(r[0]).isCloseTo(0.10, within(1e-9));
        assertThat(r[1]).isCloseTo(-0.10, within(1e-9));
        assertThat(TechnicalIndicators.returns(List.of(100.0))).isEmpty();
    }

    @Test
    @DisplayName("An EMA starts as the simple average of its first window, then weights recent values more")
    void ema() {
        double[] values = {2, 4, 6, 8, 10};

        double[] ema = TechnicalIndicators.ema(values, 3);

        assertThat(ema[0]).isNaN();
        assertThat(ema[1]).isNaN();
        assertThat(ema[2]).isEqualTo(4.0);          // mean of 2, 4, 6
        assertThat(ema[3]).isEqualTo(6.0);          // 8 * 0.5 + 4 * 0.5
        assertThat(ema[4]).isEqualTo(8.0);          // 10 * 0.5 + 6 * 0.5
    }

    @Test
    @DisplayName("An EMA of a constant series is that constant, and a short series has none")
    void emaEdges() {
        double[] flat = new double[20];
        java.util.Arrays.fill(flat, 7.0);

        assertThat(TechnicalIndicators.ema(flat, 10)[19]).isCloseTo(7.0, within(1e-9));
        assertThat(TechnicalIndicators.ema(new double[]{1, 2}, 5)[1]).isNaN();
    }

    @Test
    @DisplayName("MACD is positive and its histogram moves with a steady climb, and needs 35 closes")
    void macd() {
        TechnicalIndicators.Macd rising = TechnicalIndicators.macd(seq(60, i -> 100 + i));
        TechnicalIndicators.Macd falling = TechnicalIndicators.macd(seq(60, i -> 200 - i));

        assertThat(rising.line()).isGreaterThan(0);
        assertThat(falling.line()).isLessThan(0);
        assertThat(TechnicalIndicators.macd(seq(34, i -> 100 + i))).isNull();
        assertThat(TechnicalIndicators.macd(seq(35, i -> 100 + i))).isNotNull();
    }

    @Test
    @DisplayName("The MACD histogram turns negative when a rally stalls and falls")
    void macdTurn() {
        List<Double> closes = new ArrayList<>(seq(50, i -> 100 + i));
        for (int i = 0; i < 12; i++) {
            closes.add(closes.get(closes.size() - 1) - 3);
        }

        TechnicalIndicators.Macd macd = TechnicalIndicators.macd(closes);

        assertThat(macd.histogram()).isLessThan(0);
        assertThat(macd.histogram()).isLessThan(macd.previousHistogram());
    }

    @Test
    @DisplayName("Bollinger %B is 0.5 mid-band, above 1 past the upper band, and 0.5 for a flat series")
    void bollinger() {
        List<Double> alternating = seq(20, i -> i % 2 == 0 ? 99 : 101);
        List<Double> breakout = new ArrayList<>(alternating);
        breakout.set(19, 110.0);

        TechnicalIndicators.Bollinger calm = TechnicalIndicators.bollinger(alternating, 20, 2);
        TechnicalIndicators.Bollinger broke = TechnicalIndicators.bollinger(breakout, 20, 2);

        assertThat(calm.middle()).isEqualTo(100.0);
        assertThat(calm.upper()).isGreaterThan(calm.middle());
        assertThat(broke.percentB()).isGreaterThan(1.0);
        assertThat(TechnicalIndicators.bollinger(seq(20, i -> 50), 20, 2).percentB()).isEqualTo(0.5);
        assertThat(TechnicalIndicators.bollinger(seq(19, i -> 50), 20, 2)).isNull();
    }

    @Test
    @DisplayName("ATR is the typical true range as a percentage of the last close")
    void atr() {
        List<Double> closes = seq(30, i -> 100);
        List<Double> highs = seq(30, i -> 102);
        List<Double> lows = seq(30, i -> 98);

        assertThat(TechnicalIndicators.atrPercent(highs, lows, closes, 14)).isEqualTo(4.0);
        assertThat(TechnicalIndicators.atrPercent(highs.subList(0, 10), lows.subList(0, 10), closes.subList(0, 10), 14)).isNull();
    }

    @Test
    @DisplayName("ATR counts a gap from the previous close, not only the day's own range")
    void atrGap() {
        List<Double> closes = new ArrayList<>(seq(20, i -> 100));
        List<Double> highs = new ArrayList<>(seq(20, i -> 101));
        List<Double> lows = new ArrayList<>(seq(20, i -> 99));
        closes.add(120.0);
        highs.add(121.0);
        lows.add(119.0); // gapped up 20 from a 100 close, with a 2-point day range

        Double withGap = TechnicalIndicators.atrPercent(highs, lows, closes, 14);

        assertThat(withGap).isGreaterThan(TechnicalIndicators.atrPercent(highs.subList(0, 20), lows.subList(0, 20), closes.subList(0, 20), 14));
    }

    @Test
    @DisplayName("Percentiles interpolate between the sorted values")
    void percentile() {
        double[] values = {5, 1, 3, 2, 4};

        assertThat(TechnicalIndicators.percentile(values, 0)).isEqualTo(1.0);
        assertThat(TechnicalIndicators.percentile(values, 50)).isEqualTo(3.0);
        assertThat(TechnicalIndicators.percentile(values, 100)).isEqualTo(5.0);
        assertThat(TechnicalIndicators.percentile(values, 25)).isEqualTo(2.0);
        assertThat(TechnicalIndicators.percentile(new double[]{1, 2}, 50)).isEqualTo(1.5);
        assertThatThrownBy(() -> TechnicalIndicators.percentile(new double[0], 50)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("Standard deviation is the sample one, and zero for a flat or tiny series")
    void standardDeviation() {
        assertThat(TechnicalIndicators.standardDeviation(new double[]{2, 4, 4, 4, 5, 5, 7, 9})).isCloseTo(2.138, within(0.001));
        assertThat(TechnicalIndicators.standardDeviation(new double[]{3, 3, 3})).isZero();
        assertThat(TechnicalIndicators.standardDeviation(new double[]{3})).isZero();
    }

    @Test
    @DisplayName("Horizon returns overlap: one per start day")
    void horizonReturns() {
        double[] r = TechnicalIndicators.horizonReturns(List.of(100.0, 110.0, 121.0, 133.1), 2);

        assertThat(r).hasSize(2);
        assertThat(r[0]).isCloseTo(0.21, within(1e-9));
        assertThat(r[1]).isCloseTo(0.21, within(1e-9));
    }
}
