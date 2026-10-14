package com.team1.trading.api.chat;

import com.team1.trading.api.dto.PositionResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class PortfolioAnalyticsTest {

    private static PositionResponse position(String symbol, int quantity, String averageCost) {
        return new PositionResponse(1L, symbol, quantity, new BigDecimal(averageCost), BigDecimal.ZERO);
    }

    private static BigDecimal d(String value) {
        return new BigDecimal(value);
    }

    @Test
    @DisplayName("Holdings are valued at the latest price, with profit or loss and weight in the whole portfolio")
    void valuation() {
        PortfolioAnalytics.Valuation v = PortfolioAnalytics.valuate(
                List.of(position("TCS", 10, "3000.00"), position("INFY", 20, "1500.00")),
                Map.of("TCS", d("3500.00"), "INFY", d("1400.00")),
                d("7000.00"));

        assertThat(v.holdingsValue()).isEqualByComparingTo("63000.00"); // 35000 + 28000
        assertThat(v.totalValue()).isEqualByComparingTo("70000.00");
        assertThat(v.unrealisedPnl()).isEqualByComparingTo("3000.00"); // +5000 on TCS, -2000 on INFY
        assertThat(v.cashPct()).isEqualTo(10.0);

        PortfolioAnalytics.Holding tcs = v.holdings().get(0);
        assertThat(tcs.symbol()).isEqualTo("TCS"); // largest first
        assertThat(tcs.value()).isEqualByComparingTo("35000.00");
        assertThat(tcs.unrealisedPnl()).isEqualByComparingTo("5000.00");
        assertThat(tcs.unrealisedPnlPct()).isEqualTo(16.67);
        assertThat(tcs.weightPct()).isEqualTo(50.0);
        assertThat(v.holdings().get(1).unrealisedPnl()).isEqualByComparingTo("-2000.00");
    }

    @Test
    @DisplayName("Concentration reports the largest holding and a Herfindahl index of the weights")
    void concentration() {
        PortfolioAnalytics.Valuation one = PortfolioAnalytics.valuate(
                List.of(position("TCS", 10, "100")), Map.of("TCS", d("100")), BigDecimal.ZERO);
        PortfolioAnalytics.Valuation four = PortfolioAnalytics.valuate(
                List.of(position("A", 1, "100"), position("B", 1, "100"), position("C", 1, "100"), position("D", 1, "100")),
                Map.of("A", d("100"), "B", d("100"), "C", d("100"), "D", d("100")), BigDecimal.ZERO);

        assertThat(one.largestSymbol()).isEqualTo("TCS");
        assertThat(one.largestWeightPct()).isEqualTo(100.0);
        assertThat(one.concentrationIndex()).isEqualTo(1.0);
        assertThat(four.concentrationIndex()).isEqualTo(0.25); // four equal holdings
    }

    @Test
    @DisplayName("A holding with no live price is valued at cost, flagged, and left out of profit and loss")
    void unpriced() {
        PortfolioAnalytics.Valuation v = PortfolioAnalytics.valuate(
                List.of(position("TATAMOTORS", 5, "900.00"), position("TCS", 1, "3000.00")),
                Map.of("TCS", d("3100.00")), BigDecimal.ZERO);

        assertThat(v.unpriced()).containsExactly("TATAMOTORS");
        assertThat(v.holdingsValue()).isEqualByComparingTo("7600.00"); // 4500 at cost + 3100
        assertThat(v.unrealisedPnl()).isEqualByComparingTo("100.00");  // TCS only
        PortfolioAnalytics.Holding tata = v.holdings().stream().filter(h -> h.symbol().equals("TATAMOTORS")).findFirst().orElseThrow();
        assertThat(tata.price()).isNull();
        assertThat(tata.unrealisedPnl()).isNull();
    }

    @Test
    @DisplayName("An empty portfolio is just cash, with no concentration and no divide-by-zero")
    void empty() {
        PortfolioAnalytics.Valuation v = PortfolioAnalytics.valuate(List.of(), Map.of(), d("500.00"));

        assertThat(v.holdings()).isEmpty();
        assertThat(v.totalValue()).isEqualByComparingTo("500.00");
        assertThat(v.cashPct()).isEqualTo(100.0);
        assertThat(v.largestSymbol()).isNull();
        assertThat(v.concentrationIndex()).isZero();

        PortfolioAnalytics.Valuation nothing = PortfolioAnalytics.valuate(List.of(), Map.of(), BigDecimal.ZERO);
        assertThat(nothing.cashPct()).isZero();
    }

    @Test
    @DisplayName("Zero-quantity rows are ignored")
    void zeroQuantity() {
        PortfolioAnalytics.Valuation v = PortfolioAnalytics.valuate(
                List.of(position("TCS", 0, "100")), Map.of("TCS", d("100")), BigDecimal.ZERO);

        assertThat(v.holdings()).isEmpty();
    }
}
