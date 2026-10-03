package com.team1.trading.api.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

/**
 * The latest polled quote for one tradable instrument, as served by
 * {@code GET /api/v1/market/quotes}.
 *
 * <p>An instrument the poller has not yet priced is still listed, with a null {@code price}:
 * the market screen can then show the ticker as "waiting for first quote" instead of silently
 * dropping it.
 */
public class MarketQuoteResponse {

    private String symbol;
    private String name;
    private BigDecimal price;
    private BigDecimal bid;
    private BigDecimal ask;
    private String currency;
    private BigDecimal change;
    private BigDecimal changePercent;
    private BigDecimal previousClose;
    private String marketState;
    private Boolean stale;
    /** When the quote was produced upstream. */
    private OffsetDateTime quoteAsOf;
    /** When this API received it, i.e. the poll cycle that fetched it. */
    private OffsetDateTime receivedAt;

    public MarketQuoteResponse() {
    }

    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

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

    public Boolean getStale() { return stale; }
    public void setStale(Boolean stale) { this.stale = stale; }

    public OffsetDateTime getQuoteAsOf() { return quoteAsOf; }
    public void setQuoteAsOf(OffsetDateTime quoteAsOf) { this.quoteAsOf = quoteAsOf; }

    public OffsetDateTime getReceivedAt() { return receivedAt; }
    public void setReceivedAt(OffsetDateTime receivedAt) { this.receivedAt = receivedAt; }
}
