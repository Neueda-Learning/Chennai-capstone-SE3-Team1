package com.team1.trading.api.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.team1.trading.domain.dto.PlaceOrderRequest;
import com.team1.trading.domain.entity.types.OrderSide;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * An order plus the condition it waits for. The order fields mean exactly what they mean on
 * POST /api/v1/orders: price is the limit the executor fills at or better once the order is released.
 */
public class ConditionalOrderRequest {

    public static final int DEFAULT_EXPIRY_DAYS = 30;

    @NotNull
    @Min(1)
    private Long accountId;

    @NotBlank
    @Size(max = 20)
    private String symbol;

    @NotNull
    private OrderSide side;

    @NotNull
    @Min(1)
    private Integer quantity;

    @NotNull
    @DecimalMin("0.01")
    @Digits(integer = 12, fraction = 2)
    private BigDecimal price;

    @NotBlank
    @Size(min = 8, max = 100)
    private String idempotencyKey;

    @NotNull
    @Valid
    private ConditionSpec condition;

    @Min(1)
    @Max(90)
    private Integer expiresInDays;

    public ConditionalOrderRequest() {
    }

    public ConditionalOrderRequest(Long accountId, String symbol, OrderSide side, Integer quantity, BigDecimal price,
                                   String idempotencyKey, ConditionSpec condition, Integer expiresInDays) {
        this.accountId = accountId;
        this.symbol = symbol;
        this.side = side;
        this.quantity = quantity;
        this.price = price;
        this.idempotencyKey = idempotencyKey;
        this.condition = condition;
        this.expiresInDays = expiresInDays;
    }

    public PlaceOrderRequest toOrder() {
        return new PlaceOrderRequest(accountId, symbol, side, quantity, price, idempotencyKey);
    }

    public int expiryDays() {
        return expiresInDays == null ? DEFAULT_EXPIRY_DAYS : expiresInDays;
    }

    public Long getAccountId() { return accountId; }
    public void setAccountId(Long accountId) { this.accountId = accountId; }
    public String getSymbol() { return symbol; }
    public void setSymbol(String symbol) { this.symbol = symbol; }
    public OrderSide getSide() { return side; }
    public void setSide(OrderSide side) { this.side = side; }
    public Integer getQuantity() { return quantity; }
    public void setQuantity(Integer quantity) { this.quantity = quantity; }
    public BigDecimal getPrice() { return price; }
    public void setPrice(BigDecimal price) { this.price = price; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public void setIdempotencyKey(String idempotencyKey) { this.idempotencyKey = idempotencyKey; }
    public ConditionSpec getCondition() { return condition; }
    public void setCondition(ConditionSpec condition) { this.condition = condition; }
    public Integer getExpiresInDays() { return expiresInDays; }
    public void setExpiresInDays(Integer expiresInDays) { this.expiresInDays = expiresInDays; }

    @JsonAnySetter
    void rejectUnknown(String property, Object value) {
        throw new IllegalArgumentException("unknown property: " + property);
    }
}
