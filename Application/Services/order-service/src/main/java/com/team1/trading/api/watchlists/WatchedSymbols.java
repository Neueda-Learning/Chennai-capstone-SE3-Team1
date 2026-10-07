package com.team1.trading.api.watchlists;

import java.util.List;

/**
 * The one thing Watchlists publishes to other modules: which instruments a customer is watching.
 *
 * Advice uses it to decide which symbols to state a view on. It is a Java call, not a route,
 * and it reveals symbols only; watchlist names, ids and alerts stay inside this package.
 */
public interface WatchedSymbols {

    /** Distinct symbols across all of the account's watchlists, in the order they were first added. */
    List<String> symbolsWatchedBy(long accountId);
}
