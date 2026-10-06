package com.team1.trading.api.watchlists;

import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.watchlists.WatchlistMapper.EntryRow;
import com.team1.trading.api.watchlists.WatchlistMapper.WatchlistRow;
import com.team1.trading.domain.exception.AccountNotFoundException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Service
public class WatchlistService {

    public static final int MAX_WATCHLISTS = 10;
    public static final int MAX_INSTRUMENTS = 50;

    private final WatchlistMapper mapper;
    private final InstrumentMapper instruments;

    public WatchlistService(WatchlistMapper mapper, InstrumentMapper instruments) {
        this.mapper = mapper;
        this.instruments = instruments;
    }

    @Transactional(readOnly = true)
    public List<WatchlistResponse> list(long accountId) {
        Map<String, List<WatchlistEntryResponse>> entries = new LinkedHashMap<>();
        for (EntryRow row : mapper.findEntries(accountId)) {
            entries.computeIfAbsent(row.getWatchlistId(), k -> new ArrayList<>()).add(toEntry(row));
        }
        List<WatchlistResponse> result = new ArrayList<>();
        for (WatchlistRow row : mapper.findWatchlists(accountId)) {
            result.add(toResponse(row, entries.getOrDefault(row.getId(), List.of())));
        }
        return result;
    }

    @Transactional
    public WatchlistResponse create(long accountId, CreateWatchlistRequest request) {
        String name = request.getName().trim();
        if (name.isEmpty()) {
            throw new WatchlistInvalidException("A watchlist needs a name");
        }
        lock(accountId);
        if (mapper.countWatchlists(accountId) >= MAX_WATCHLISTS) {
            throw new WatchlistLimitException("An account can hold at most " + MAX_WATCHLISTS + " watchlists");
        }
        if (mapper.countByName(accountId, name) > 0) {
            throw new WatchlistConflictException("You already have a watchlist with that name");
        }
        String id = UUID.randomUUID().toString();
        try {
            mapper.insertWatchlist(id, accountId, name, WatchlistSupport.now());
        } catch (DuplicateKeyException e) {
            throw new WatchlistConflictException("You already have a watchlist with that name");
        }
        return toResponse(mapper.findWatchlist(accountId, id).orElseThrow(), List.of());
    }

    @Transactional
    public void delete(long accountId, String watchlistId) {
        String id = WatchlistSupport.id(watchlistId, "Watchlist");
        if (mapper.deleteWatchlist(accountId, id) == 0) {
            throw new WatchlistNotFoundException("Watchlist");
        }
    }

    @Transactional
    public WatchlistEntryResponse addInstrument(long accountId, String watchlistId, AddInstrumentRequest request) {
        String id = WatchlistSupport.id(watchlistId, "Watchlist");
        mapper.findWatchlist(accountId, id).orElseThrow(() -> new WatchlistNotFoundException("Watchlist"));
        String symbol = WatchlistSupport.activeSymbol(instruments, request.getSymbol());
        lock(accountId);
        if (mapper.countInstrument(id, symbol) == 0) {
            if (mapper.countInstruments(id) >= MAX_INSTRUMENTS) {
                throw new WatchlistLimitException("A watchlist can hold at most " + MAX_INSTRUMENTS + " instruments");
            }
            mapper.insertInstrument(id, symbol, WatchlistSupport.now());
        }
        return toEntry(mapper.findEntry(id, symbol).orElseThrow());
    }

    @Transactional
    public void removeInstrument(long accountId, String watchlistId, String rawSymbol) {
        String id = WatchlistSupport.id(watchlistId, "Watchlist");
        mapper.findWatchlist(accountId, id).orElseThrow(() -> new WatchlistNotFoundException("Watchlist"));
        String symbol = rawSymbol == null ? "" : rawSymbol.trim().toUpperCase(Locale.ROOT);
        if (mapper.deleteInstrument(id, symbol) == 0) {
            throw new WatchlistNotFoundException("Instrument");
        }
    }

    private void lock(long accountId) {
        if (mapper.lockAccount(accountId).isEmpty()) {
            throw new AccountNotFoundException(accountId);
        }
    }

    private static WatchlistResponse toResponse(WatchlistRow row, List<WatchlistEntryResponse> entries) {
        return new WatchlistResponse(row.getId(), row.getName(), WatchlistSupport.utc(row.getCreatedAt()), entries);
    }

    private static WatchlistEntryResponse toEntry(EntryRow row) {
        return new WatchlistEntryResponse(row.getSymbol(), row.getName(), row.getPrice(), row.getCurrency(),
                row.getChangePercent(), row.isStale(), row.getQuoteAsOf());
    }
}
