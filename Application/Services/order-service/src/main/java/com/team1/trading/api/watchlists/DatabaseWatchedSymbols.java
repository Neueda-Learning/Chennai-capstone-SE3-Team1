package com.team1.trading.api.watchlists;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Component
class DatabaseWatchedSymbols implements WatchedSymbols {

    private final WatchlistMapper mapper;

    DatabaseWatchedSymbols(WatchlistMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    @Transactional(readOnly = true)
    public List<String> symbolsWatchedBy(long accountId) {
        return mapper.findWatchedSymbols(accountId);
    }
}
