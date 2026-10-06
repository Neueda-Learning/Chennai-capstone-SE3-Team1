package com.team1.trading.api.watchlists;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.Objects;

public class AddInstrumentRequest {

    @NotBlank
    @Size(max = 20)
    private String symbol;

    public AddInstrumentRequest() {
    }

    public AddInstrumentRequest(String symbol) {
        this.symbol = symbol;
    }

    public String getSymbol() {
        return symbol;
    }

    public void setSymbol(String symbol) {
        this.symbol = symbol;
    }

    @JsonAnySetter
    void rejectUnknown(String property, Object value) {
        throw new IllegalArgumentException("unknown property: " + property);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof AddInstrumentRequest other && Objects.equals(symbol, other.symbol);
    }

    @Override
    public int hashCode() {
        return Objects.hash(symbol);
    }
}
