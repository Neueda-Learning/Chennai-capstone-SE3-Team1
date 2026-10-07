package com.team1.trading.api.advice;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** The shapes the advice routes, the dashboard and the assistant read. All built from the ETL's published rows. */
public final class AdviceViews {

    private AdviceViews() {
    }

    public record Indicators(
            BigDecimal close,
            BigDecimal sma20,
            BigDecimal sma50,
            BigDecimal rsi14,
            BigDecimal return20dPct,
            BigDecimal volatilityPct,
            BigDecimal maxDrawdownPct,
            String trend) {
    }

    public record Prediction(
            LocalDate forDate,
            LocalDate asOf,
            BigDecimal lastClose,
            BigDecimal predictedClose,
            BigDecimal low68,
            BigDecimal high68,
            BigDecimal low90,
            BigDecimal high90,
            BigDecimal probUp,
            BigDecimal expectedReturnPct) {
    }

    /**
     * One instrument's analysis. status INSUFFICIENT_DATA means no suggestion was made (too little history,
     * or nothing published yet); summary always says why. stale is true when the data the analysis was
     * computed from is more than a few days old.
     */
    public record Signal(
            String symbol,
            String name,
            List<SignalSource> sources,
            Integer heldQuantity,
            BigDecimal averageCost,
            String status,
            String suggestion,
            String confidence,
            BigDecimal score,
            String summary,
            List<String> reasons,
            Indicators indicators,
            LocalDate asOf,
            boolean stale,
            Prediction prediction) {
    }

    /** The strongest published suggestions across the market, for the dashboard. */
    public record Ideas(List<Signal> buy, List<Signal> sell) {
    }

    public record Advice(
            long accountId,
            String model,
            String methodology,
            String disclaimer,
            LocalDateTime generatedAt,
            LocalDate dataAsOf,
            boolean stale,
            List<Signal> signals,
            Ideas ideas) {
    }
}
