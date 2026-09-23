package com.team1.trading.api.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * Body of {@code POST /api/v1/accounts/{id}/transfers}. The bank account is always the one
 * linked to the account in the path, so the body never names it.
 */
public class TransferRequest {

    @NotNull
    private TransferDirection direction;

    @NotNull
    @DecimalMin(value = "0.01")
    @Digits(integer = 16, fraction = 2)
    private BigDecimal amount;

    @NotBlank
    @Size(min = 8, max = 100)
    private String idempotencyKey;

    public TransferRequest() {
    }

    public TransferRequest(TransferDirection direction, BigDecimal amount, String idempotencyKey) {
        this.direction = direction;
        this.amount = amount;
        this.idempotencyKey = idempotencyKey;
    }

    public TransferDirection getDirection() {
        return direction;
    }

    public void setDirection(TransferDirection direction) {
        this.direction = direction;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public void setIdempotencyKey(String idempotencyKey) {
        this.idempotencyKey = idempotencyKey;
    }
}
