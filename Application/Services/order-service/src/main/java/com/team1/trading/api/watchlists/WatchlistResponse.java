package com.team1.trading.api.watchlists;

import java.time.OffsetDateTime;
import java.util.List;

public record WatchlistResponse(
        String id,
        String name,
        OffsetDateTime createdAt,
        List<WatchlistEntryResponse> instruments) {
}
