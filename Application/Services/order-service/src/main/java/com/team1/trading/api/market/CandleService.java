package com.team1.trading.api.market;

import com.team1.trading.api.dto.CandleResponse;
import com.team1.trading.api.mapper.CandleMapper;
import com.team1.trading.api.mapper.CandleMapper.DailyCandleWrite;
import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.market.FauxnanceCandleClient.CandleFetchException;
import com.team1.trading.domain.exception.InstrumentNotFoundException;
import com.team1.trading.domain.exception.InvalidOrderException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Candles for the price chart, at a chosen interval over a chosen range.
 *
 * <p>Two sources, because Fauxnance only serves daily candles:
 * <ul>
 *   <li><b>Intraday</b> ({@code 1m 5m 15m 30m 1h}) are built from the quotes the poller already
 *       stores, one a minute, so they cost no quota. They exist only from when polling started,
 *       and carry no volume.</li>
 *   <li><b>Daily and longer</b> ({@code 1d 1w 1mo}) come from a year of stored end-of-day history.
 *       That history is fetched from Fauxnance <em>once per instrument per day</em> - one request
 *       returns the whole year for one symbol - and every chart after that reads the table.</li>
 * </ul>
 */
@Service
public class CandleService {

    private static final Logger log = LoggerFactory.getLogger(CandleService.class);

    /** NSE time: candle boundaries and "today" are read on this clock. */
    static final ZoneId MARKET_ZONE = ZoneId.of("Asia/Kolkata");

    /** How far back a sync reaches: enough for every daily range, YTD and 1Y included. */
    static final int HISTORY_DAYS = 366;

    /** The most candles one response may hold. Stops "1m over 3 days" asking for 4,000 points. */
    static final int MAX_CANDLES = 2_000;

    /** After a failed fetch, do not ask Fauxnance again for this long: each ask costs quota. */
    static final Duration RETRY_AFTER_FAILURE = Duration.ofMinutes(15);

    /** Intervals, in seconds. Daily and longer are rolled up from daily candles instead. */
    private static final Map<String, Integer> INTRADAY_SECONDS = Map.of(
            "1m", 60, "5m", 300, "15m", 900, "30m", 1_800, "1h", 3_600);

    /** Intraday windows. Bounded by how long market_quotes is kept. */
    private static final Map<String, Duration> INTRADAY_RANGES = Map.of(
            "1h", Duration.ofHours(1), "3h", Duration.ofHours(3), "8h", Duration.ofHours(8),
            "1d", Duration.ofDays(1), "3d", Duration.ofDays(3), "1w", Duration.ofDays(7));

    private static final List<String> DAILY_INTERVALS = List.of("1d", "1w", "1mo");
    private static final List<String> DAILY_RANGES = List.of("1mo", "3mo", "6mo", "ytd", "1y");

    private final CandleMapper candleMapper;
    private final InstrumentMapper instrumentMapper;
    private final FauxnanceCandleClient client;
    private final Clock clock;

    private final Map<String, Object> locks = new ConcurrentHashMap<>();
    private final Map<String, Instant> lastFailure = new ConcurrentHashMap<>();

    @Autowired
    public CandleService(CandleMapper candleMapper, InstrumentMapper instrumentMapper, FauxnanceCandleClient client) {
        this(candleMapper, instrumentMapper, client, Clock.systemUTC());
    }

    CandleService(CandleMapper candleMapper, InstrumentMapper instrumentMapper, FauxnanceCandleClient client, Clock clock) {
        this.candleMapper = candleMapper;
        this.instrumentMapper = instrumentMapper;
        this.client = client;
        this.clock = clock;
    }

    /**
     * @throws InstrumentNotFoundException ({@code INS-404}) for an unknown or delisted symbol
     * @throws InvalidOrderException       ({@code VAL-422}) for an unknown interval or range, or a
     *                                     combination that makes no sense (a 1-minute candle over a
     *                                     year, a daily candle over an hour)
     */
    public List<CandleResponse> candles(String symbol, String interval, String range) {
        String normalised = symbol == null ? "" : symbol.trim().toUpperCase();
        boolean tradable = instrumentMapper.findRowBySymbol(normalised)
                .map(InstrumentMapper.InstrumentRow::isActive).orElse(false);
        if (!tradable) {
            throw new InstrumentNotFoundException(symbol);
        }
        // Case-insensitive, but "1m" is a minute and the month is spelled "1mo".
        String iv = interval == null ? "" : interval.trim().toLowerCase();
        String rg = range == null ? "" : range.trim().toLowerCase();

        if (INTRADAY_SECONDS.containsKey(iv) && INTRADAY_RANGES.containsKey(rg)) {
            return intraday(normalised, iv, rg);
        }
        if (DAILY_INTERVALS.contains(iv) && DAILY_RANGES.contains(rg)) {
            return daily(normalised, iv, rg);
        }
        throw new InvalidOrderException("interval/range", interval + "/" + range);
    }

    private List<CandleResponse> intraday(String symbol, String interval, String range) {
        Duration window = INTRADAY_RANGES.get(range);
        int bucket = INTRADAY_SECONDS.get(interval);
        if (window.toSeconds() / bucket > MAX_CANDLES) {
            throw new InvalidOrderException("interval/range", interval + "/" + range);
        }
        OffsetDateTime since = OffsetDateTime.ofInstant(clock.instant().minus(window), MARKET_ZONE);
        return candleMapper.intraday(symbol, since, bucket);
    }

    private List<CandleResponse> daily(String symbol, String interval, String range) {
        ensureDailyHistory(symbol);
        LocalDate today = LocalDate.now(clock.withZone(MARKET_ZONE));
        LocalDate from = switch (range) {
            case "1mo" -> today.minusMonths(1);
            case "3mo" -> today.minusMonths(3);
            case "6mo" -> today.minusMonths(6);
            case "ytd" -> LocalDate.of(today.getYear(), 1, 1);
            default -> today.minusYears(1);
        };

        List<CandleResponse> candles = switch (interval) {
            case "1w" -> candleMapper.rolledUp(symbol, from, "week");
            case "1mo" -> candleMapper.rolledUp(symbol, from, "month");
            default -> candleMapper.daily(symbol, from);
        };

        if ("1d".equals(interval)) {
            return withToday(symbol, today, candles);
        }
        return candles;
    }

    /**
     * End-of-day history lags the market, so today's candle is built from today's polled prices
     * until the real one arrives. Skipped when the stored history already has today.
     */
    private List<CandleResponse> withToday(String symbol, LocalDate today, List<CandleResponse> candles) {
        boolean haveToday = !candles.isEmpty()
                && candles.get(candles.size() - 1).getTime().atZoneSameInstant(MARKET_ZONE).toLocalDate().equals(today);
        if (haveToday) {
            return candles;
        }
        OffsetDateTime startOfToday = today.atStartOfDay(MARKET_ZONE).toOffsetDateTime();
        List<CandleResponse> ticks = candleMapper.intraday(symbol, startOfToday, (int) Duration.ofDays(1).toSeconds());
        if (ticks.isEmpty()) {
            return candles;
        }
        CandleResponse todays = ticks.get(ticks.size() - 1);
        todays.setTime(startOfToday);
        List<CandleResponse> out = new ArrayList<>(candles);
        out.add(todays);
        return out;
    }

    /**
     * Makes sure a year of daily history is stored and was fetched today. One request per
     * instrument per day; a failure is remembered for a while so a down or exhausted Fauxnance is
     * not asked again on every chart redraw, and the chart is served from whatever is stored.
     */
    void ensureDailyHistory(String symbol) {
        LocalDate today = LocalDate.now(clock.withZone(MARKET_ZONE));
        synchronized (locks.computeIfAbsent(symbol, s -> new Object())) {
            if (candleMapper.lastSyncedOn(symbol).filter(today::equals).isPresent()) {
                return;
            }
            Instant failedAt = lastFailure.get(symbol);
            if (failedAt != null && Duration.between(failedAt, clock.instant()).compareTo(RETRY_AFTER_FAILURE) < 0) {
                return;
            }
            LocalDate from = today.minusDays(HISTORY_DAYS);
            try {
                store(symbol, today, from, client.fetchDaily(symbol, from, today));
                lastFailure.remove(symbol);
            } catch (CandleFetchException e) {
                lastFailure.put(symbol, clock.instant());
                log.warn("Daily history for {} could not be refreshed ({}); serving what is stored", symbol, e.getMessage());
            }
        }
    }

    void store(String symbol, LocalDate today, LocalDate from, List<DailyCandleWrite> fetched) {
        // An empty answer is not a sync: it would mark a symbol "done today" with nothing stored.
        if (fetched.isEmpty()) {
            throw new CandleFetchException("Fauxnance returned no candles for " + symbol);
        }
        // Rows first, the sync marker last: a failure part-way leaves the symbol unmarked, so the
        // next request simply tries again (the upserts are idempotent).
        fetched.forEach(candleMapper::upsertDaily);
        candleMapper.markSynced(symbol, today, from, fetched.size());
        log.info("Stored {} daily candles for {} (one Fauxnance request)", fetched.size(), symbol);
    }
}
