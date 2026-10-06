package com.team1.trading.api.watchlists;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.team1.trading.api.notifications.Direction;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.Objects;

public class CreateAlertRequest {

    @NotBlank
    @Size(max = 20)
    private String symbol;

    @NotNull
    @DecimalMin(value = "0", inclusive = false)
    @DecimalMax("99999999999999.9999")
    @Digits(integer = 14, fraction = 4)
    private BigDecimal threshold;

    @NotNull
    private Direction direction;

    public CreateAlertRequest() {
    }

    public CreateAlertRequest(String symbol, BigDecimal threshold, Direction direction) {
        this.symbol = symbol;
        this.threshold = threshold;
        this.direction = direction;
    }

    public String getSymbol() {
        return symbol;
    }

    public void setSymbol(String symbol) {
        this.symbol = symbol;
    }

    public BigDecimal getThreshold() {
        return threshold;
    }

    public void setThreshold(BigDecimal threshold) {
        this.threshold = threshold;
    }

    public Direction getDirection() {
        return direction;
    }

    public void setDirection(Direction direction) {
        this.direction = direction;
    }

    @JsonAnySetter
    void rejectUnknown(String property, Object value) {
        throw new IllegalArgumentException("unknown property: " + property);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof CreateAlertRequest other
                && Objects.equals(symbol, other.symbol)
                && threshold != null && other.threshold != null && threshold.compareTo(other.threshold) == 0
                && direction == other.direction;
    }

    @Override
    public int hashCode() {
        return Objects.hash(symbol, threshold == null ? null : threshold.stripTrailingZeros(), direction);
    }
}
