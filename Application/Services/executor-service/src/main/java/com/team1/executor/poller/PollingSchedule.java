package com.team1.executor.poller;

import com.team1.executor.quote.FauxnanceQuoteClient;

public final class PollingSchedule {

    public static final int DAILY_QUOTA = 2_000;

    public static final int FILL_PATH_RESERVE = 500;

    public static final int POLLER_DAILY_BUDGET = DAILY_QUOTA - FILL_PATH_RESERVE;

    static final int SECONDS_PER_DAY = 86_400;

    private PollingSchedule() {
    }

    public static int requestsPerPoll(int symbolCount) {
        if (symbolCount <= 0) {
            return 0;
        }
        return ceilDiv(symbolCount, FauxnanceQuoteClient.MAX_SYMBOLS_PER_REQUEST);
    }

    public static int requestsPerDay(int symbolCount, int intervalSeconds) {
        requirePositive(intervalSeconds);
        return requestsPerPoll(symbolCount) * ceilDiv(SECONDS_PER_DAY, intervalSeconds);
    }

    public static int floorSeconds(int symbolCount) {
        int perPoll = Math.max(requestsPerPoll(symbolCount), 1);
        return ceilDiv(SECONDS_PER_DAY * perPoll, POLLER_DAILY_BUDGET);
    }

    public static int absoluteFloorSeconds() {
        return floorSeconds(FauxnanceQuoteClient.MAX_SYMBOLS_PER_REQUEST);
    }

    public static int enforceFloor(int intervalSeconds) {
        return Math.max(intervalSeconds, absoluteFloorSeconds());
    }

    public static boolean withinDailyBudget(int symbolCount, int intervalSeconds) {
        return requestsPerDay(symbolCount, intervalSeconds) <= POLLER_DAILY_BUDGET;
    }

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
