package com.team1.trading.api.advice;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Read-only access to what the ETL analysis job publishes (migration 032). This module never writes either
 * table: the job in Application/ETL/etl-live/analysis.py owns them.
 */
@Mapper
public interface AnalysisMapper {

    String ANALYSIS_COLUMNS = """
            a.instrument_id AS symbol, i.instrument_name AS name, a.as_of AS asOf, a.status, a.observations,
            a.close_price AS closePrice, a.sma_20 AS sma20, a.sma_50 AS sma50, a.rsi_14 AS rsi14,
            a.return_20d_pct AS return20dPct, a.volatility_pct AS volatilityPct,
            a.max_drawdown_pct AS maxDrawdownPct, a.trend, a.score, a.suggestion, a.confidence,
            a.reasons, a.summary, a.model, a.generated_at AS generatedAt
            """;

    @Select("SELECT " + ANALYSIS_COLUMNS + """
            FROM market_analysis a
            JOIN instruments i ON i.instrument_id = a.instrument_id
            WHERE i.active = TRUE
            ORDER BY a.instrument_id
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<AnalysisRow> findAll();

    /** The latest prediction per active instrument: the one for the furthest session predicted. */
    @Select("""
            SELECT p.instrument_id AS symbol, p.for_date AS forDate, p.as_of AS asOf, p.last_close AS lastClose,
                   p.predicted_close AS predictedClose, p.low_68 AS low68, p.high_68 AS high68,
                   p.low_90 AS low90, p.high_90 AS high90, p.prob_up AS probUp,
                   p.expected_return_pct AS expectedReturnPct, p.model, p.generated_at AS generatedAt
            FROM daily_predictions p
            JOIN instruments i ON i.instrument_id = p.instrument_id
            WHERE i.active = TRUE
              AND p.for_date = (SELECT MAX(p2.for_date) FROM daily_predictions p2
                                WHERE p2.instrument_id = p.instrument_id)
            ORDER BY p.instrument_id
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<PredictionRow> latestPredictions();

    /** A symbol's predictions, newest session first, so the assistant can compare them with what happened. */
    @Select("""
            SELECT instrument_id AS symbol, for_date AS forDate, as_of AS asOf, last_close AS lastClose,
                   predicted_close AS predictedClose, low_68 AS low68, high_68 AS high68,
                   low_90 AS low90, high_90 AS high90, prob_up AS probUp,
                   expected_return_pct AS expectedReturnPct, model, generated_at AS generatedAt
            FROM daily_predictions
            WHERE instrument_id = #{symbol}
            ORDER BY for_date DESC
            LIMIT #{limit}
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<PredictionRow> predictionsFor(@Param("symbol") String symbol, @Param("limit") int limit);

    class AnalysisRow {
        private String symbol;
        private String name;
        private LocalDate asOf;
        private String status;
        private int observations;
        private BigDecimal closePrice;
        private BigDecimal sma20;
        private BigDecimal sma50;
        private BigDecimal rsi14;
        private BigDecimal return20dPct;
        private BigDecimal volatilityPct;
        private BigDecimal maxDrawdownPct;
        private String trend;
        private BigDecimal score;
        private String suggestion;
        private String confidence;
        private String reasons;
        private String summary;
        private String model;
        private LocalDateTime generatedAt;

        public String getSymbol() { return symbol; }
        public void setSymbol(String symbol) { this.symbol = symbol; }
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public LocalDate getAsOf() { return asOf; }
        public void setAsOf(LocalDate asOf) { this.asOf = asOf; }
        public String getStatus() { return status; }
        public void setStatus(String status) { this.status = status; }
        public int getObservations() { return observations; }
        public void setObservations(int observations) { this.observations = observations; }
        public BigDecimal getClosePrice() { return closePrice; }
        public void setClosePrice(BigDecimal closePrice) { this.closePrice = closePrice; }
        public BigDecimal getSma20() { return sma20; }
        public void setSma20(BigDecimal sma20) { this.sma20 = sma20; }
        public BigDecimal getSma50() { return sma50; }
        public void setSma50(BigDecimal sma50) { this.sma50 = sma50; }
        public BigDecimal getRsi14() { return rsi14; }
        public void setRsi14(BigDecimal rsi14) { this.rsi14 = rsi14; }
        public BigDecimal getReturn20dPct() { return return20dPct; }
        public void setReturn20dPct(BigDecimal return20dPct) { this.return20dPct = return20dPct; }
        public BigDecimal getVolatilityPct() { return volatilityPct; }
        public void setVolatilityPct(BigDecimal volatilityPct) { this.volatilityPct = volatilityPct; }
        public BigDecimal getMaxDrawdownPct() { return maxDrawdownPct; }
        public void setMaxDrawdownPct(BigDecimal maxDrawdownPct) { this.maxDrawdownPct = maxDrawdownPct; }
        public String getTrend() { return trend; }
        public void setTrend(String trend) { this.trend = trend; }
        public BigDecimal getScore() { return score; }
        public void setScore(BigDecimal score) { this.score = score; }
        public String getSuggestion() { return suggestion; }
        public void setSuggestion(String suggestion) { this.suggestion = suggestion; }
        public String getConfidence() { return confidence; }
        public void setConfidence(String confidence) { this.confidence = confidence; }
        public String getReasons() { return reasons; }
        public void setReasons(String reasons) { this.reasons = reasons; }
        public String getSummary() { return summary; }
        public void setSummary(String summary) { this.summary = summary; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public LocalDateTime getGeneratedAt() { return generatedAt; }
        public void setGeneratedAt(LocalDateTime generatedAt) { this.generatedAt = generatedAt; }
    }

    class PredictionRow {
        private String symbol;
        private LocalDate forDate;
        private LocalDate asOf;
        private BigDecimal lastClose;
        private BigDecimal predictedClose;
        private BigDecimal low68;
        private BigDecimal high68;
        private BigDecimal low90;
        private BigDecimal high90;
        private BigDecimal probUp;
        private BigDecimal expectedReturnPct;
        private String model;
        private LocalDateTime generatedAt;

        public String getSymbol() { return symbol; }
        public void setSymbol(String symbol) { this.symbol = symbol; }
        public LocalDate getForDate() { return forDate; }
        public void setForDate(LocalDate forDate) { this.forDate = forDate; }
        public LocalDate getAsOf() { return asOf; }
        public void setAsOf(LocalDate asOf) { this.asOf = asOf; }
        public BigDecimal getLastClose() { return lastClose; }
        public void setLastClose(BigDecimal lastClose) { this.lastClose = lastClose; }
        public BigDecimal getPredictedClose() { return predictedClose; }
        public void setPredictedClose(BigDecimal predictedClose) { this.predictedClose = predictedClose; }
        public BigDecimal getLow68() { return low68; }
        public void setLow68(BigDecimal low68) { this.low68 = low68; }
        public BigDecimal getHigh68() { return high68; }
        public void setHigh68(BigDecimal high68) { this.high68 = high68; }
        public BigDecimal getLow90() { return low90; }
        public void setLow90(BigDecimal low90) { this.low90 = low90; }
        public BigDecimal getHigh90() { return high90; }
        public void setHigh90(BigDecimal high90) { this.high90 = high90; }
        public BigDecimal getProbUp() { return probUp; }
        public void setProbUp(BigDecimal probUp) { this.probUp = probUp; }
        public BigDecimal getExpectedReturnPct() { return expectedReturnPct; }
        public void setExpectedReturnPct(BigDecimal expectedReturnPct) { this.expectedReturnPct = expectedReturnPct; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public LocalDateTime getGeneratedAt() { return generatedAt; }
        public void setGeneratedAt(LocalDateTime generatedAt) { this.generatedAt = generatedAt; }
    }
}
