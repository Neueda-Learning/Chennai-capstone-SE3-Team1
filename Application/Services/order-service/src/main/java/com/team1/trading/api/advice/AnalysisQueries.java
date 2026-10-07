package com.team1.trading.api.advice;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.trading.api.advice.AdviceViews.Indicators;
import com.team1.trading.api.advice.AdviceViews.Prediction;
import com.team1.trading.api.advice.AdviceViews.Signal;
import com.team1.trading.api.advice.AnalysisMapper.AnalysisRow;
import com.team1.trading.api.advice.AnalysisMapper.PredictionRow;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * The published market analysis and daily predictions, as views. Account-free: what it returns is the same
 * for every customer, so it is safe for the assistant and the dashboard. Personal context (holdings,
 * watchlists) is added by {@link AdviceService}, behind the account check.
 */
@Service
public class AnalysisQueries {

    static final ZoneId MARKET_ZONE = ZoneId.of("Asia/Kolkata");
    /** Data older than this, in calendar days, is flagged stale: a weekend plus a holiday, and then some. */
    static final int STALE_AFTER_DAYS = 4;

    public static final String METHODOLOGY = "Computed by the ETL analysis job from daily closing prices. "
            + "Trend: +40 when the 20-day average is above the 50-day and the close is above the 20-day, -40 for "
            + "the reverse. Momentum: the 20-day return doubled, capped at +/-30. RSI(14): -20 above 70, +20 below "
            + "30. A score of 30 or more is BUY, -30 or less is SELL, otherwise HOLD. The next-session prediction is "
            + "half the recent average daily return with a range from the last 60 sessions' volatility; the chance "
            + "of an up session is kept between 40% and 60%.";

    public static final String DISCLAIMER = "Generated automatically from public price history by fixed rules. "
            + "It is information, not a personal recommendation: it does not know your goals, your other assets "
            + "or your tolerance for risk, and past prices do not predict future ones.";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final AnalysisMapper mapper;
    private final Clock clock;

    @Autowired
    public AnalysisQueries(AnalysisMapper mapper) {
        this(mapper, Clock.system(MARKET_ZONE));
    }

    AnalysisQueries(AnalysisMapper mapper, Clock clock) {
        this.mapper = mapper;
        this.clock = clock;
    }

    /** Every published analysis keyed by symbol, each with its latest prediction. */
    public Map<String, Signal> all() {
        Map<String, PredictionRow> predictions = new LinkedHashMap<>();
        for (PredictionRow row : mapper.latestPredictions()) {
            predictions.put(row.getSymbol(), row);
        }
        Map<String, Signal> out = new LinkedHashMap<>();
        for (AnalysisRow row : mapper.findAll()) {
            out.put(row.getSymbol(), toSignal(row, predictions.get(row.getSymbol())));
        }
        return out;
    }

    public Optional<Signal> find(String symbol) {
        return Optional.ofNullable(all().get(normalise(symbol)));
    }

    /** The strongest suggestions of one kind (BUY highest score first, SELL lowest first). */
    public List<Signal> ranked(String suggestion, int limit) {
        Comparator<Signal> order = Comparator.comparing(Signal::score);
        return all().values().stream()
                .filter(s -> suggestion.equals(s.suggestion()) && s.score() != null)
                .sorted("SELL".equals(suggestion) ? order : order.reversed())
                .limit(limit)
                .toList();
    }

    public List<Prediction> predictionsFor(String symbol, int limit) {
        return mapper.predictionsFor(normalise(symbol), limit).stream().map(AnalysisQueries::toPrediction).toList();
    }

    public Optional<java.time.LocalDateTime> lastRun() {
        return mapper.findAll().stream().map(AnalysisRow::getGeneratedAt).filter(g -> g != null)
                .max(Comparator.naturalOrder());
    }

    /** The model that produced the published rows, as the job records it. */
    public Optional<String> model() {
        return mapper.findAll().stream().map(AnalysisRow::getModel).filter(m -> m != null).findFirst();
    }

    public boolean isStale(LocalDate asOf) {
        return asOf == null || asOf.isBefore(LocalDate.now(clock).minusDays(STALE_AFTER_DAYS));
    }

    /** What a symbol with no published analysis looks like: listed, with no suggestion and the reason. */
    public Signal unpublished(String symbol, String name) {
        return new Signal(symbol, name, List.of(), null, null, "INSUFFICIENT_DATA", null, null, null,
                "No analysis has been published for " + symbol + " yet; it appears after the next analysis run.",
                List.of(), null, null, true, null);
    }

    Signal toSignal(AnalysisRow row, PredictionRow prediction) {
        Indicators indicators = new Indicators(row.getClosePrice(), row.getSma20(), row.getSma50(), row.getRsi14(),
                row.getReturn20dPct(), row.getVolatilityPct(), row.getMaxDrawdownPct(), row.getTrend());
        return new Signal(row.getSymbol(), row.getName(), List.of(), null, null, row.getStatus(),
                row.getSuggestion(), row.getConfidence(), row.getScore(), row.getSummary(), reasons(row.getReasons()),
                indicators, row.getAsOf(), isStale(row.getAsOf()),
                prediction == null ? null : toPrediction(prediction));
    }

    static Prediction toPrediction(PredictionRow p) {
        return new Prediction(p.getForDate(), p.getAsOf(), p.getLastClose(), p.getPredictedClose(), p.getLow68(),
                p.getHigh68(), p.getLow90(), p.getHigh90(), p.getProbUp(), p.getExpectedReturnPct());
    }

    private static List<String> reasons(String json) {
        try {
            return json == null || json.isBlank() ? List.of() : JSON.readValue(json, new TypeReference<>() {
            });
        } catch (Exception e) {
            return List.of(json);
        }
    }

    static String normalise(String symbol) {
        return symbol == null ? "" : symbol.trim().toUpperCase(Locale.ROOT);
    }
}
