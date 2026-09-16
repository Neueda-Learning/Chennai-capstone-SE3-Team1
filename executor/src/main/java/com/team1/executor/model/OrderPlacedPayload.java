package com.team1.executor.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = true)
public record OrderPlacedPayload(
        @JsonProperty("orderId") UUID orderId,
        @JsonProperty("accountId") Long accountId,
        @JsonProperty("symbol") String symbol,
        @JsonProperty("side") String side,
        @JsonProperty("quantity") Integer quantity,
        @JsonProperty("price") BigDecimal price,
        @JsonProperty("idempotencyKey") String idempotencyKey,
        @JsonProperty("createdOn") Instant createdOn
) {}