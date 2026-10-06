package com.team1.trading.api.watchlists;

import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.mapper.InstrumentMapper.InstrumentRow;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.UUID;

final class WatchlistSupport {

    private WatchlistSupport() {
    }

    static String id(String raw, String what) {
        try {
            return UUID.fromString(raw.trim()).toString();
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new WatchlistNotFoundException(what);
        }
    }

    static String activeSymbol(InstrumentMapper instruments, String raw) {
        String symbol = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
        InstrumentRow row = symbol.isEmpty() ? null : instruments.findRowBySymbol(symbol).orElse(null);
        if (row == null || !row.isActive()) {
            throw new WatchlistInvalidException("Unknown instrument");
        }
        return symbol;
    }

    static LocalDateTime now() {
        return LocalDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.MICROS);
    }

    static OffsetDateTime utc(LocalDateTime value) {
        return value == null ? null : value.atOffset(ZoneOffset.UTC);
    }
}
