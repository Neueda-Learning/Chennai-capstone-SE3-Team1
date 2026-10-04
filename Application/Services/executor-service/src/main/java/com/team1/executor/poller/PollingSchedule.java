package com.team1.executor.poller;

import com.team1.executor.quote.FauxnanceQuoteClient;

/**
 * The Fauxnance quota arithmetic, as code rather than as a comment in a README.
 *
 * <p>One key, {@value #DAILY_QUOTA} requests per day, resetting at 00:00 UTC, shared by the two
 * things in this executor that call Fauxnance: this poller and the fill path in
 * {@code OrderConsumer}. We reserve {@value #FILL_PATH_RESERVE} of the day for the fill path,
 * because an order rejected for want of a price is a worse outcome than a missing quote tick,
 * which leaves {@value #POLLER_DAILY_BUDGET} for polling.
 *
 * <p>The batch endpoint costs one request whatever the symbol count up to
 * {@link FauxnanceQuoteClient#MAX_SYMBOLS_PER_REQUEST}, which is what makes the floor survivable:
 * eight symbols fetched one at a time every 30 seconds is 23040 requests and the key is gone in
 * two hours, where the same data batched is 2880.
 *
 * <p>See {@code design/kafka.md} for the full working.
 */
public final class PollingSchedule {

    /** Requests per day per key, resetting at 00:00 UTC. */
    public static final int DAILY_QUOTA = 2_000;

    /** Held back for pricing fills, which must never be blocked by the poller. */
    public static final int FILL_PATH_RESERVE = 500;

    /** What the poller may spend in a day. */
    public static final int POLLER_DAILY_BUDGET = DAILY_QUOTA - FILL_PATH_RESERVE;

    static final int SECONDS_PER_DAY = 86_400;

    private PollingSchedule() {
    }

    /** HTTP requests one poll cycle costs: one per batch of 25, zero when nothing is held. */
    public static int requestsPerPoll(int symbolCount) {
        if (symbolCount <= 0) {
            return 0;
        }
        return ceilDiv(symbolCount, FauxnanceQuoteClient.MAX_SYMBOLS_PER_REQUEST);
    }

    /** What this configuration would spend in 24 hours. */
    public static int requestsPerDay(int symbolCount, int intervalSeconds) {
        requirePositive(intervalSeconds);
        return requestsPerPoll(symbolCount) * ceilDiv(SECONDS_PER_DAY, intervalSeconds);
    }

    /**
     * The fastest interval that keeps {@code symbolCount} symbols inside the poller's daily
     * budget. For one batch that is {@code ceil(86400 / 1500) = 58} seconds.
     */
    public static int floorSeconds(int symbolCount) {
        int perPoll = Math.max(requestsPerPoll(symbolCount), 1);
        return ceilDiv(SECONDS_PER_DAY * perPoll, POLLER_DAILY_BUDGET);
    }

    /**
     * The floor for a single batch: no symbol set can justify an interval below this, so it is
     * the one that can be enforced at startup without knowing what is held.
     */
    public static int absoluteFloorSeconds() {
        return floorSeconds(FauxnanceQuoteClient.MAX_SYMBOLS_PER_REQUEST);
    }

    /**
     * Raises an interval to the floor. Clamping rather than refusing to start, because the poller
     * must not be able to take the fill path down with it, and the safe direction is unambiguous.
     */
    public static int enforceFloor(int intervalSeconds) {
        return Math.max(intervalSeconds, absoluteFloorSeconds());
    }

    public static boolean withinDailyBudget(int symbolCount, int intervalSeconds) {
        return requestsPerDay(symbolCount, intervalSeconds) <= POLLER_DAILY_BUDGET;
    }

    /** One line of evidence for the log and the review. */
    public static String describe(int symbolCount, int intervalSeconds) {
        return String.format(
                "%d symbol(s), %d request(s) per poll, every %ds = %d requests/day against a %d poller budget (%d reserved for fills)",
                symbolCount,
                requestsPerPoll(symbolCount),
                intervalSeconds,
                requestsPerDay(symbolCount, intervalSeconds),
                POLLER_DAILY_BUDGET,
                FILL_PATH_RESERVE);
    }

    private static void requirePositive(int intervalSeconds) {
        if (intervalSeconds <= 0) {
            throw new IllegalArgumentException("Poll interval must be positive, was " + intervalSeconds);
        }
    }

    private static int ceilDiv(int dividend, int divisor) {
        return (dividend + divisor - 1) / divisor;
    }
}
