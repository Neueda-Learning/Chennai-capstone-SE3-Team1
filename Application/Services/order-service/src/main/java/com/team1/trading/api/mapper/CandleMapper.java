package com.team1.trading.api.mapper;

import com.team1.trading.api.dto.CandleResponse;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

@Mapper
public interface CandleMapper {

    @Select("""
            SELECT b.bucket AS time,
                   (array_agg(b.price ORDER BY b.received_at ASC, b.quote_id ASC))[1]  AS open,
                   max(b.price)                                                         AS high,
                   min(b.price)                                                         AS low,
                   (array_agg(b.price ORDER BY b.received_at DESC, b.quote_id DESC))[1] AS close
            FROM (
                SELECT date_bin(make_interval(secs => #{bucketSeconds}), received_at,
                                TIMESTAMPTZ '2000-01-03 00:00:00+05:30') AS bucket,
                       price, received_at, quote_id
                FROM market_quotes
                WHERE instrument_id = #{symbol}
                  AND received_at >= #{since}
            ) b
            GROUP BY b.bucket
            ORDER BY b.bucket ASC
            """)
    List<CandleResponse> intraday(@Param("symbol") String symbol,
                                  @Param("since") OffsetDateTime since,
                                  @Param("bucketSeconds") int bucketSeconds);

    @Select("""
            SELECT (trade_date::timestamp AT TIME ZONE 'Asia/Kolkata') AS time,
                   open_price AS open, high_price AS high, low_price AS low, close_price AS close, volume
            FROM daily_candles
            WHERE instrument_id = #{symbol}
              AND trade_date >= #{from}
            ORDER BY trade_date ASC
            """)
    List<CandleResponse> daily(@Param("symbol") String symbol, @Param("from") LocalDate from);

    @Select("""
            SELECT (g.period::timestamp AT TIME ZONE 'Asia/Kolkata') AS time,
                   (array_agg(g.open_price ORDER BY g.trade_date ASC))[1]  AS open,
                   max(g.high_price)                                       AS high,
                   min(g.low_price)                                        AS low,
                   (array_agg(g.close_price ORDER BY g.trade_date DESC))[1] AS close,
                   sum(g.volume)::bigint                                   AS volume
            FROM (
                SELECT date_trunc(#{unit}, trade_date::timestamp)::date AS period, *
                FROM daily_candles
                WHERE instrument_id = #{symbol}
                  AND trade_date >= #{from}
            ) g
            GROUP BY g.period
            ORDER BY g.period ASC
            """)
    List<CandleResponse> rolledUp(@Param("symbol") String symbol, @Param("from") LocalDate from,
                                  @Param("unit") String unit);

    @Insert("""
            INSERT INTO daily_candles (instrument_id, trade_date, open_price, high_price, low_price,
                                       close_price, adj_close, volume, synthetic)
            VALUES (#{c.symbol}, #{c.tradeDate}, #{c.open}, #{c.high}, #{c.low}, #{c.close},
                    #{c.adjClose}, #{c.volume}, #{c.synthetic})
            ON CONFLICT (instrument_id, trade_date) DO UPDATE
               SET open_price = EXCLUDED.open_price, high_price = EXCLUDED.high_price,
                   low_price = EXCLUDED.low_price, close_price = EXCLUDED.close_price,
                   adj_close = EXCLUDED.adj_close, volume = EXCLUDED.volume,
                   synthetic = EXCLUDED.synthetic
            """)
    int upsertDaily(@Param("c") DailyCandleWrite candle);

    @Select("SELECT synced_on FROM daily_candle_syncs WHERE instrument_id = #{symbol}")
    Optional<LocalDate> lastSyncedOn(@Param("symbol") String symbol);

    @Insert("""
            INSERT INTO daily_candle_syncs (instrument_id, synced_on, covers_from, candle_count)
            VALUES (#{symbol}, #{syncedOn}, #{coversFrom}, #{count})
            ON CONFLICT (instrument_id) DO UPDATE
               SET synced_on = EXCLUDED.synced_on, covers_from = EXCLUDED.covers_from,
                   candle_count = EXCLUDED.candle_count
            """)
    int markSynced(@Param("symbol") String symbol, @Param("syncedOn") LocalDate syncedOn,
                   @Param("coversFrom") LocalDate coversFrom, @Param("count") int count);

    class DailyCandleWrite {
        private String symbol;
        private LocalDate tradeDate;
        private BigDecimal open;
        private BigDecimal high;
        private BigDecimal low;
        private BigDecimal close;
        private BigDecimal adjClose;
        private Long volume;
        private boolean synthetic;

        public String getSymbol() { return symbol; }
        public void setSymbol(String symbol) { this.symbol = symbol; }
        public LocalDate getTradeDate() { return tradeDate; }
        public void setTradeDate(LocalDate tradeDate) { this.tradeDate = tradeDate; }
        public BigDecimal getOpen() { return open; }
        public void setOpen(BigDecimal open) { this.open = open; }
        public BigDecimal getHigh() { return high; }
        public void setHigh(BigDecimal high) { this.high = high; }
        public BigDecimal getLow() { return low; }
        public void setLow(BigDecimal low) { this.low = low; }
        public BigDecimal getClose() { return close; }
        public void setClose(BigDecimal close) { this.close = close; }
        public BigDecimal getAdjClose() { return adjClose; }
        public void setAdjClose(BigDecimal adjClose) { this.adjClose = adjClose; }
        public Long getVolume() { return volume; }
        public void setVolume(Long volume) { this.volume = volume; }
        public boolean isSynthetic() { return synthetic; }
        public void setSynthetic(boolean synthetic) { this.synthetic = synthetic; }
    }
}
