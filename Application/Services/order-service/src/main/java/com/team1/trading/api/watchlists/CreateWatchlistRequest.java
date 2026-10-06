package com.team1.trading.api.watchlists;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.Objects;

public class CreateWatchlistRequest {

    @NotBlank
    @Size(max = 60)
    private String name;

    public CreateWatchlistRequest() {
    }

    public CreateWatchlistRequest(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    @JsonAnySetter
    void rejectUnknown(String property, Object value) {
        throw new IllegalArgumentException("unknown property: " + property);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof CreateWatchlistRequest other && Objects.equals(name, other.name);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name);
    }
}
