package com.team1.trading.api.chat;

import com.team1.trading.api.dto.PositionResponse;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * Values a portfolio at the latest prices and measures how concentrated it is. Money is BigDecimal
 * throughout; the only doubles are the percentages and the concentration index, which are for reading.
 */
public final class PortfolioAnalytics {

    public record Holding(
            String symbol,
            int quantity,
            BigDecimal averageCost,
            /** Null when no price is known for the symbol. */
            BigDecimal price,
            BigDecimal value,
            BigDecimal unrealisedPnl,
            Double unrealisedPnlPct,
            double weightPct) {
    }

    public record Valuation(
            BigDecimal cash,
            BigDecimal holdingsValue,
            BigDecimal totalValue,
            BigDecimal unrealisedPnl,
            double cashPct,
            List<Holding> holdings,
            String largestSymbol,
            double largestWeightPct,
            /** Herfindahl index of the holdings' weights within the whole portfolio: 0 spread out, 1 one stock. */
            double concentrationIndex,
            List<String> unpriced) {
    }

    private PortfolioAnalytics() {
    }

    public static Valuation valuate(List<PositionResponse> positions, Map<String, BigDecimal> prices, BigDecimal cash) {
        BigDecimal cashValue = cash == null ? BigDecimal.ZERO : cash;
        List<String> unpriced = new ArrayList<>();

        record Priced(PositionResponse position, BigDecimal price, BigDecimal value) {
        }
        List<Priced> priced = new ArrayList<>();
        BigDecimal holdingsValue = BigDecimal.ZERO;
        for (PositionResponse position : positions) {
            int quantity = position.getQuantity() == null ? 0 : position.getQuantity();
            if (quantity <= 0) {
                continue;
            }
            BigDecimal price = prices.get(position.getSymbol());
            BigDecimal value;
            if (price == null) {
                // No live price: fall back to cost so the portfolio total is not understated, and say so.
                unpriced.add(position.getSymbol());
                value = money(position.getAverageCost()).multiply(BigDecimal.valueOf(quantity));
            } else {
                value = price.multiply(BigDecimal.valueOf(quantity));
            }
            priced.add(new Priced(position, price, value));
            holdingsValue = holdingsValue.add(value);
        }

        BigDecimal total = holdingsValue.add(cashValue);
        List<Holding> holdings = new ArrayList<>();
        BigDecimal pnl = BigDecimal.ZERO;
        double concentration = 0;
        for (Priced p : priced) {
            int quantity = p.position().getQuantity();
            BigDecimal cost = money(p.position().getAverageCost());
            BigDecimal unrealised = p.price() == null ? null
                    : p.price().subtract(cost).multiply(BigDecimal.valueOf(quantity)).setScale(2, RoundingMode.HALF_UP);
            Double unrealisedPct = p.price() == null || cost.signum() == 0 ? null
                    : p.price().subtract(cost).multiply(BigDecimal.valueOf(100))
                            .divide(cost, 2, RoundingMode.HALF_UP).doubleValue();
            double weight = share(p.value(), total);
            concentration += (weight / 100) * (weight / 100);
            if (unrealised != null) {
                pnl = pnl.add(unrealised);
            }
            holdings.add(new Holding(p.position().getSymbol(), quantity, cost.setScale(2, RoundingMode.HALF_UP),
                    p.price() == null ? null : p.price().setScale(2, RoundingMode.HALF_UP),
                    p.value().setScale(2, RoundingMode.HALF_UP), unrealised, unrealisedPct, round(weight)));
        }
        holdings.sort(Comparator.comparingDouble(Holding::weightPct).reversed());

        Holding largest = holdings.isEmpty() ? null : holdings.get(0);
        return new Valuation(
                cashValue.setScale(2, RoundingMode.HALF_UP),
                holdingsValue.setScale(2, RoundingMode.HALF_UP),
                total.setScale(2, RoundingMode.HALF_UP),
                pnl.setScale(2, RoundingMode.HALF_UP),
                round(share(cashValue, total)),
                holdings,
                largest == null ? null : largest.symbol(),
                largest == null ? 0 : largest.weightPct(),
                Math.round(concentration * 10_000.0) / 10_000.0,
                unpriced);
    }

    private static BigDecimal money(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static double share(BigDecimal part, BigDecimal whole) {
        if (whole.signum() == 0) {
            return 0;
        }
        return part.multiply(BigDecimal.valueOf(100)).divide(whole, 4, RoundingMode.HALF_UP).doubleValue();
    }

    private static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
