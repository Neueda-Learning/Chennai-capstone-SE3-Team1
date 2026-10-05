package com.team1.trading.api.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

public class MarketPoint {

    private OffsetDateTime at;
    private BigDecimal price;

    public MarketPoint() {
    }

    public MarketPoint(OffsetDateTime at, BigDecimal price) {
        this.at = at;
        this.price = price;
    }

    public OffsetDateTime getAt() { return at; }
    public void setAt(OffsetDateTime at) { this.at = at; }

    public BigDecimal getPrice() { return price; }
    public void setPrice(BigDecimal price) { this.price = price; }
}
