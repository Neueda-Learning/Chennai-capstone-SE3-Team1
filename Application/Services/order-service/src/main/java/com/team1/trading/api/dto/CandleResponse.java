package com.team1.trading.api.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

/**
 * One OHLC candle of {@code GET /api/v1/market/quotes/{symbol}/candles}. {@code time} is the start
 * of the period the candle covers. {@code volume} is only known for daily and longer candles:
 * the intraday ones are built from polled prices, which carry no traded volume.
 */
public class CandleResponse {

    private OffsetDateTime time;
    private BigDecimal open;
    private BigDecimal high;
    private BigDecimal low;
    private BigDecimal close;
    private Long volume;

    public CandleResponse() {
    }

    public OffsetDateTime getTime() { return time; }
    public void setTime(OffsetDateTime time) { this.time = time; }

    public BigDecimal getOpen() { return open; }
    public void setOpen(BigDecimal open) { this.open = open; }

    public BigDecimal getHigh() { return high; }
    public void setHigh(BigDecimal high) { this.high = high; }

    public BigDecimal getLow() { return low; }
    public void setLow(BigDecimal low) { this.low = low; }

    public BigDecimal getClose() { return close; }
    public void setClose(BigDecimal close) { this.close = close; }

    public Long getVolume() { return volume; }
    public void setVolume(Long volume) { this.volume = volume; }
}
