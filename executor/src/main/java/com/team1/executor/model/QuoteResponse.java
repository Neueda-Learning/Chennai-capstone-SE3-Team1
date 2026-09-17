package com.team1.executor.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.time.Instant;

@JsonIgnoreProperties(ignoreUnknown = true)
public record QuoteResponse(
        @JsonProperty("symbol") String symbol,
        @JsonProperty("price") BigDecimal price,
        @JsonProperty("bid") BigDecimal bid,
        @JsonProperty("ask") BigDecimal ask,
        @JsonProperty("currency") String currency,
        @JsonProperty("change") BigDecimal change,
        @JsonProperty("changePercent") BigDecimal changePercent,
        @JsonProperty("previousClose") BigDecimal previousClose,
        @JsonProperty("marketState") String marketState,
        @JsonProperty("stale") Boolean stale,
        @JsonProperty("quoteAsOf") @JsonAlias("asOf") Instant quoteAsOf
) {
}