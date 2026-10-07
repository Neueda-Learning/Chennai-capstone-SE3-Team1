package com.team1.trading.api.advice;

import com.team1.trading.api.advice.AdviceViews.Signal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

/** The read side of the ETL's published tables, against H2 with the schema migration 032 creates. */
@MybatisTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:analysisqueries;DB_CLOSE_DELAY=-1")
class AnalysisQueriesTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 7);

    @Autowired
    private AnalysisMapper mapper;
    @Autowired
    private JdbcTemplate jdbc;

    private AnalysisQueries queries;

    @BeforeEach
    void publish() {
        queries = new AnalysisQueries(mapper,
                Clock.fixed(TODAY.atStartOfDay(ZoneId.of("Asia/Kolkata")).toInstant(), ZoneId.of("Asia/Kolkata")));
        jdbc.update("DELETE FROM market_analysis");
        jdbc.update("DELETE FROM daily_predictions");
        analysis("TCS", "OK", "BUY", "HIGH", 70, TODAY.minusDays(1));
        analysis("INFY", "OK", "BUY", "MEDIUM", 40, TODAY.minusDays(1));
        analysis("ITC", "OK", "SELL", "MEDIUM", -45, TODAY.minusDays(1));
        analysis("RELIANCE", "OK", "HOLD", "LOW", 5, TODAY.minusDays(10));
        analysis("LEGACYCORP", "OK", "BUY", "HIGH", 90, TODAY.minusDays(1));
        jdbc.update("INSERT INTO market_analysis (instrument_id, as_of, status, observations, reasons, summary, model, "
                + "run_id, generated_at) VALUES ('HDFCBANK', ?, 'INSUFFICIENT_DATA', 12, '[]', "
                + "'Only 12 daily closes are stored for HDFCBANK', 'm1', 'run-1', ?)",
                Date.valueOf(TODAY.minusDays(1)), Timestamp.valueOf(LocalDateTime.of(2026, 10, 6, 18, 0)));
        prediction("TCS", TODAY.minusDays(2), "3500");
        prediction("TCS", TODAY, "3555.50");
    }

    private void analysis(String symbol, String status, String suggestion, String confidence, int score, LocalDate asOf) {
        jdbc.update("INSERT INTO market_analysis (instrument_id, as_of, status, observations, close_price, sma_20, "
                        + "sma_50, rsi_14, trend, score, suggestion, confidence, reasons, summary, model, run_id, "
                        + "generated_at) VALUES (?, ?, ?, 250, 100, 99, 95, 55, 'UP', ?, ?, ?, ?, ?, 'm1', 'run-1', ?)",
                symbol, Date.valueOf(asOf), status, score, suggestion, confidence,
                "[\"Uptrend: the 20-day average is above the 50-day.\",\"Momentum: +4.00% over 20 sessions.\"]",
                suggestion + " (" + confidence.toLowerCase() + " confidence)",
                Timestamp.valueOf(LocalDateTime.of(2026, 10, 6, 18, 0)));
    }

    private void prediction(String symbol, LocalDate forDate, String predicted) {
        jdbc.update("INSERT INTO daily_predictions (instrument_id, for_date, as_of, last_close, predicted_close, low_68, "
                        + "high_68, low_90, high_90, prob_up, expected_return_pct, model, run_id, generated_at) "
                        + "VALUES (?, ?, ?, 3500, ?, 3450, 3600, 3400, 3650, 0.53, 0.12, 'm1', 'run-1', ?)",
                symbol, Date.valueOf(forDate), Date.valueOf(forDate.minusDays(1)), new java.math.BigDecimal(predicted),
                Timestamp.valueOf(LocalDateTime.of(2026, 10, 6, 18, 0)));
    }

    @Test
    @DisplayName("A published analysis comes back with its suggestion, reasons, indicators and latest prediction")
    void oneSymbol() {
        Signal tcs = queries.find("tcs").orElseThrow();

        assertThat(tcs.suggestion()).isEqualTo("BUY");
        assertThat(tcs.confidence()).isEqualTo("HIGH");
        assertThat(tcs.reasons()).containsExactly("Uptrend: the 20-day average is above the 50-day.",
                "Momentum: +4.00% over 20 sessions.");
        assertThat(tcs.indicators().sma20()).isEqualByComparingTo("99");
        assertThat(tcs.name()).isEqualTo("Tata Consultancy Services");
        assertThat(tcs.stale()).isFalse();
        assertThat(tcs.prediction().forDate()).as("the latest session predicted").isEqualTo(TODAY);
        assertThat(tcs.prediction().predictedClose()).isEqualByComparingTo("3555.50");
    }

    @Test
    @DisplayName("Too little history is published as INSUFFICIENT_DATA with no suggestion")
    void insufficient() {
        Signal hdfc = queries.find("HDFCBANK").orElseThrow();

        assertThat(hdfc.status()).isEqualTo("INSUFFICIENT_DATA");
        assertThat(hdfc.suggestion()).isNull();
        assertThat(hdfc.summary()).contains("Only 12 daily closes");
        assertThat(queries.find("ICICIBANK")).as("nothing published").isEmpty();
    }

    @Test
    @DisplayName("Ideas rank BUY by highest score and SELL by lowest; inactive instruments are left out")
    void ranked() {
        assertThat(queries.ranked("BUY", 5)).extracting(Signal::symbol).containsExactly("TCS", "INFY");
        assertThat(queries.ranked("SELL", 5)).extracting(Signal::symbol).containsExactly("ITC");
        assertThat(queries.ranked("BUY", 1)).extracting(Signal::symbol).containsExactly("TCS");
    }

    @Test
    @DisplayName("Data more than four days old is flagged stale")
    void stale() {
        assertThat(queries.find("RELIANCE").orElseThrow().stale()).isTrue();
    }

    @Test
    @DisplayName("A symbol's prediction history comes back newest first")
    void history() {
        assertThat(queries.predictionsFor("TCS", 5)).extracting(AdviceViews.Prediction::forDate)
                .containsExactly(TODAY, TODAY.minusDays(2));
        assertThat(queries.predictionsFor("TCS", 1)).hasSize(1);
    }
}
