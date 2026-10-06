package com.team1.trading.api.watchlists;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

public record WatchlistEntryResponse(
        String symbol,
        String name,
        BigDecimal price,
        String currency,
        BigDecimal changePercent,
        boolean stale,
        OffsetDateTime quoteAsOf) {
}
