package com.team1.trading.api.chat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PriceStatsTest {

    private static List<Double> series(double... values) {
        return java.util.Arrays.stream(values).boxed().toList();
    }

    @Test
    @DisplayName("Return, high, low and last close come straight from the series")
    void basics() {
        PriceStats.Summary s = PriceStats.summarise(series(100, 110, 90, 120));

        assertThat(s.observations()).isEqualTo(4);
        assertThat(s.lastClose()).isEqualTo(120.0);
        assertThat(s.returnPct()).isEqualTo(20.0);
        assertThat(s.high()).isEqualTo(120.0);
        assertThat(s.low()).isEqualTo(90.0);
    }

    @Test
    @DisplayName("Moving averages are the mean of the last N closes, and absent without N closes")
    void movingAverages() {
        List<Double> closes = IntStream.rangeClosed(1, 50).mapToObj(Double::valueOf).toList();

        assertThat(PriceStats.sma(closes, 20)).isEqualTo(40.5); // mean of 31..50
        assertThat(PriceStats.sma(closes, 50)).isEqualTo(25.5);
        assertThat(PriceStats.sma(closes.subList(0, 19), 20)).isNull();
    }

    @Test
    @DisplayName("RSI is 100 for a series that only rises, 0 for one that only falls, 50 for a flat one")
    void rsiExtremes() {
        List<Double> up = IntStream.range(0, 30).mapToObj(i -> 100.0 + i).toList();
        List<Double> down = IntStream.range(0, 30).mapToObj(i -> 200.0 - i).toList();
        List<Double> flat = IntStream.range(0, 30).mapToObj(i -> 100.0).toList();

        assertThat(PriceStats.rsi(up, 14)).isEqualTo(100.0);
        assertThat(PriceStats.rsi(down, 14)).isEqualTo(0.0);
        assertThat(PriceStats.rsi(flat, 14)).isEqualTo(50.0);
    }

    @Test
    @DisplayName("RSI matches a hand-worked Wilder example")
    void rsiKnownValue() {
        // 14 changes: seven +1 and seven -1 -> equal average gain and loss -> RSI 50 at the first reading.
        List<Double> closes = new ArrayList<>(List.of(100.0));
        for (int i = 0; i < 7; i++) {
            closes.add(closes.get(closes.size() - 1) + 1);
            closes.add(closes.get(closes.size() - 1) - 1);
        }

        assertThat(PriceStats.rsi(closes, 14)).isEqualTo(50.0);
    }

    @Test
    @DisplayName("RSI needs period + 1 closes")
    void rsiNeedsHistory() {
        assertThat(PriceStats.rsi(series(1, 2, 3, 4, 5), 14)).isNull();
    }

    @Test
    @DisplayName("Maximum drawdown is the deepest fall from a running peak, as a negative percentage")
    void drawdown() {
        assertThat(PriceStats.maxDrawdownPct(series(100, 120, 60, 90))).isEqualTo(-50.0);
        assertThat(PriceStats.maxDrawdownPct(series(1, 2, 3))).isEqualTo(0.0);
    }

    @Test
    @DisplayName("A flat series has no volatility; a choppy one has some; two closes are too few to say")
    void volatility() {
        assertThat(PriceStats.annualisedVolatilityPct(series(50, 50, 50, 50))).isEqualTo(0.0);
        assertThat(PriceStats.annualisedVolatilityPct(series(100, 110, 100, 110, 100))).isGreaterThan(100.0);
        assertThat(PriceStats.annualisedVolatilityPct(series(100, 101))).isNull();
    }

    @Test
    @DisplayName("Volatility is the daily standard deviation scaled by the square root of 252")
    void volatilityKnownValue() {
        // Returns +10% and -10% (approximately): mean ~ 0, sample sd = sqrt(0.02) = 0.1414, x sqrt(252) x 100.
        Double volatility = PriceStats.annualisedVolatilityPct(series(100, 110, 99));

        assertThat(volatility).isBetween(224.4, 224.6); // 0.1414 x 15.8745 x 100
    }

    @Test
    @DisplayName("Fewer than two closes cannot be summarised")
    void tooShort() {
        assertThatThrownBy(() -> PriceStats.summarise(series(100)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PriceStats.summarise(null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
