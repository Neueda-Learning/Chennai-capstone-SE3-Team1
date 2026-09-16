package com.team1.executor.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = true)
public record TradeEventPayload(
        @JsonProperty("orderId") UUID orderId,
        @JsonProperty("accountId") Long accountId,
        @JsonProperty("symbol") String symbol,
        @JsonProperty("side") String side,
        @JsonProperty("quantity") Integer quantity,
        @JsonProperty("price") BigDecimal price,
        @JsonProperty("executedPrice") BigDecimal executedPrice,
        @JsonProperty("status") String status,
        @JsonProperty("reason") String reason,
        @JsonProperty("cashDelta") BigDecimal cashDelta,
        @JsonProperty("positionQuantityAfter") Integer positionQuantityAfter,
        @JsonProperty("averageCostAfter") BigDecimal averageCostAfter,
        @JsonProperty("executedOn") Instant executedOn
) {}