package com.team1.trading.api.mapper;

import com.team1.trading.api.dto.MarketPoint;
import com.team1.trading.api.dto.MarketQuoteResponse;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * The statements behind {@code market_quotes}: appended to by the market-data listener, read by
 * the market endpoints. Parameterised throughout.
 */
@Mapper
public interface MarketQuoteMapper {

    @Insert("""
            INSERT INTO market_quotes (instrument_id, price, bid, ask, currency, day_change,
                                       change_percent, previous_close, market_state, stale, quote_as_of)
            VALUES (#{q.symbol}, #{q.price}, #{q.bid}, #{q.ask}, #{q.currency}, #{q.change},
                    #{q.changePercent}, #{q.previousClose}, #{q.marketState}, #{q.stale}, #{q.quoteAsOf})
            """)
    int insert(@Param("q") QuoteInsert quote);

    /** Keeps the table a rolling window rather than an archive. */
    @Delete("""
            DELETE FROM market_quotes
            WHERE instrument_id = #{symbol}
              AND received_at < now() - make_interval(days => #{days})
            """)
    int deleteOlderThan(@Param("symbol") String symbol, @Param("days") int days);

    /**
     * Every active instrument with its most recent quote. LEFT JOIN, so an instrument the poller
     * has not priced yet still appears (with a null price) rather than vanishing.
     */
    @Select("""
            SELECT i.instrument_id AS symbol, i.instrument_name AS name,
                   q.price, q.bid, q.ask, q.currency, q.day_change AS change,
                   q.change_percent AS changePercent, q.previous_close AS previousClose,
                   q.market_state AS marketState, q.stale,
                   q.quote_as_of AS quoteAsOf, q.received_at AS receivedAt
            FROM instruments i
            LEFT JOIN LATERAL (
                SELECT * FROM market_quotes m
                WHERE m.instrument_id = i.instrument_id
                ORDER BY m.received_at DESC, m.quote_id DESC
                LIMIT 1
            ) q ON TRUE
            WHERE i.active = TRUE
            ORDER BY i.instrument_id
            """)
    List<MarketQuoteResponse> latestForActiveInstruments();

    /** The newest {@code limit} points for one symbol, returned oldest first for charting. */
    @Select("""
            SELECT h."at", h.price FROM (
                SELECT received_at AS "at", price, quote_id
                FROM market_quotes
                WHERE instrument_id = #{symbol}
                ORDER BY received_at DESC, quote_id DESC
                LIMIT #{limit}
            ) h
            ORDER BY h."at" ASC, h.quote_id ASC
            """)
    List<MarketPoint> history(@Param("symbol") String symbol, @Param("limit") int limit);

    class QuoteInsert {
        private String symbol;
        private BigDecimal price;
        private BigDecimal bid;
        private BigDecimal ask;
        private String currency;
        private BigDecimal change;
        private BigDecimal changePercent;
        private BigDecimal previousClose;
        private String marketState;
        private boolean stale;
        private OffsetDateTime quoteAsOf;

        public String getSymbol() { return symbol; }
        public void setSymbol(String symbol) { this.symbol = symbol; }
        public BigDecimal getPrice() { return price; }
        public void setPrice(BigDecimal price) { this.price = price; }
        public BigDecimal getBid() { return bid; }
        public void setBid(BigDecimal bid) { this.bid = bid; }
        public BigDecimal getAsk() { return ask; }
        public void setAsk(BigDecimal ask) { this.ask = ask; }
        public String getCurrency() { return currency; }
        public void setCurrency(String currency) { this.currency = currency; }
        public BigDecimal getChange() { return change; }
        public void setChange(BigDecimal change) { this.change = change; }
        public BigDecimal getChangePercent() { return changePercent; }
        public void setChangePercent(BigDecimal changePercent) { this.changePercent = changePercent; }
        public BigDecimal getPreviousClose() { return previousClose; }
        public void setPreviousClose(BigDecimal previousClose) { this.previousClose = previousClose; }
        public String getMarketState() { return marketState; }
        public void setMarketState(String marketState) { this.marketState = marketState; }
        public boolean isStale() { return stale; }
        public void setStale(boolean stale) { this.stale = stale; }
        public OffsetDateTime getQuoteAsOf() { return quoteAsOf; }
        public void setQuoteAsOf(OffsetDateTime quoteAsOf) { this.quoteAsOf = quoteAsOf; }
    }
}
