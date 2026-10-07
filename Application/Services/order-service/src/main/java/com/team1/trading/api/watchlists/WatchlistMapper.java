package com.team1.trading.api.watchlists;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

@Mapper
public interface WatchlistMapper {

    @Select("""
            SELECT client_id
            FROM clients
            WHERE client_id = #{accountId}
            FOR UPDATE
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<Long> lockAccount(@Param("accountId") long accountId);

    @Insert("""
            INSERT INTO watchlists (watchlist_id, account_id, name, created_at)
            VALUES (CAST(#{id} AS UUID), #{accountId}, #{name}, #{createdAt})
            """)
    int insertWatchlist(@Param("id") String id, @Param("accountId") long accountId,
                        @Param("name") String name, @Param("createdAt") LocalDateTime createdAt);

    @Select("""
            SELECT CAST(watchlist_id AS VARCHAR(36)) AS id, name, created_at AS createdAt
            FROM watchlists
            WHERE account_id = #{accountId}
            ORDER BY created_at, name
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<WatchlistRow> findWatchlists(@Param("accountId") long accountId);

    @Select("""
            SELECT CAST(watchlist_id AS VARCHAR(36)) AS id, name, created_at AS createdAt
            FROM watchlists
            WHERE account_id = #{accountId} AND watchlist_id = CAST(#{id} AS UUID)
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    Optional<WatchlistRow> findWatchlist(@Param("accountId") long accountId, @Param("id") String id);

    @Select("SELECT COUNT(*) FROM watchlists WHERE account_id = #{accountId}")
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int countWatchlists(@Param("accountId") long accountId);

    @Select("""
            SELECT COUNT(*) FROM watchlists
            WHERE account_id = #{accountId} AND LOWER(name) = LOWER(#{name})
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int countByName(@Param("accountId") long accountId, @Param("name") String name);


    @Delete("""
            DELETE FROM watchlists
            WHERE account_id = #{accountId} AND watchlist_id = CAST(#{id} AS UUID)
            """)
    int deleteWatchlist(@Param("accountId") long accountId, @Param("id") String id);

    @Select("SELECT COUNT(*) FROM watchlist_instruments WHERE watchlist_id = CAST(#{id} AS UUID)")
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int countInstruments(@Param("id") String id);

    @Select("""
            SELECT COUNT(*) FROM watchlist_instruments
            WHERE watchlist_id = CAST(#{id} AS UUID) AND instrument_id = #{symbol}
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    int countInstrument(@Param("id") String id, @Param("symbol") String symbol);

    @Insert("""
            INSERT INTO watchlist_instruments (watchlist_id, instrument_id, added_at)
            VALUES (CAST(#{id} AS UUID), #{symbol}, #{addedAt})
            """)
    int insertInstrument(@Param("id") String id, @Param("symbol") String symbol,
                         @Param("addedAt") LocalDateTime addedAt);

    @Delete("""
            DELETE FROM watchlist_instruments
            WHERE watchlist_id = CAST(#{id} AS UUID) AND instrument_id = #{symbol}
            """)
    int deleteInstrument(@Param("id") String id, @Param("symbol") String symbol);

    @Select("""
            SELECT CAST(wi.watchlist_id AS VARCHAR(36)) AS watchlistId, wi.instrument_id AS symbol,
                   i.instrument_name AS name, q.price, q.currency,
                   q.change_percent AS changePercent, q.stale, q.quote_as_of AS quoteAsOf
            FROM watchlist_instruments wi
            JOIN watchlists w ON w.watchlist_id = wi.watchlist_id
            JOIN instruments i ON i.instrument_id = wi.instrument_id
            LEFT JOIN market_quotes q ON q.quote_id = (
                SELECT q2.quote_id FROM market_quotes q2
                WHERE q2.instrument_id = wi.instrument_id
                ORDER BY q2.received_at DESC, q2.quote_id DESC
                LIMIT 1)
            WHERE w.account_id = #{accountId}
            ORDER BY wi.added_at, wi.instrument_id
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<EntryRow> findEntries(@Param("accountId") long accountId);

    @Select("""
            SELECT CAST(wi.watchlist_id AS VARCHAR(36)) AS watchlistId, wi.instrument_id AS symbol,
                   i.instrument_name AS name, q.price, q.currency,
                   q.change_percent AS changePercent, q.stale, q.quote_as_of AS quoteAsOf
            FROM watchlist_instruments wi
            JOIN instruments i ON i.instrument_id = wi.instrument_id
            LEFT JOIN market_quotes q ON q.quote_id = (
                SELECT q2.quote_id FROM market_quotes q2
                WHERE q2.instrument_id = wi.instrument_id
                ORDER BY q2.received_at DESC, q2.quote_id DESC
                LIMIT 1)
            WHERE wi.watchlist_id = CAST(#{id} AS UUID) AND wi.instrument_id = #{symbol}
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    Optional<EntryRow> findEntry(@Param("id") String id, @Param("symbol") String symbol);

    @Select("""
            SELECT wi.instrument_id
            FROM watchlist_instruments wi
            JOIN watchlists w ON w.watchlist_id = wi.watchlist_id
            WHERE w.account_id = #{accountId}
            GROUP BY wi.instrument_id
            ORDER BY MIN(wi.added_at), wi.instrument_id
            """)
    @Options(flushCache = Options.FlushCachePolicy.TRUE)
    List<String> findWatchedSymbols(@Param("accountId") long accountId);

    class WatchlistRow {
        private String id;
        private String name;
        private LocalDateTime createdAt;

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public LocalDateTime getCreatedAt() { return createdAt; }
        public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    }

    class EntryRow {
        private String watchlistId;
        private String symbol;
        private String name;
        private BigDecimal price;
        private String currency;
        private BigDecimal changePercent;
        private boolean stale;
        private OffsetDateTime quoteAsOf;

        public String getWatchlistId() { return watchlistId; }
        public void setWatchlistId(String watchlistId) { this.watchlistId = watchlistId; }
        public String getSymbol() { return symbol; }
        public void setSymbol(String symbol) { this.symbol = symbol; }
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public BigDecimal getPrice() { return price; }
        public void setPrice(BigDecimal price) { this.price = price; }
        public String getCurrency() { return currency; }
        public void setCurrency(String currency) { this.currency = currency; }
        public BigDecimal getChangePercent() { return changePercent; }
        public void setChangePercent(BigDecimal changePercent) { this.changePercent = changePercent; }
        public boolean isStale() { return stale; }
        public void setStale(boolean stale) { this.stale = stale; }
        public OffsetDateTime getQuoteAsOf() { return quoteAsOf; }
        public void setQuoteAsOf(OffsetDateTime quoteAsOf) { this.quoteAsOf = quoteAsOf; }
    }
}
