package com.team1.trading.api.watchlists;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotNull;

import java.util.Objects;

public class UpdateAlertRequest {

    @NotNull
    private SettableAlertState state;

    public UpdateAlertRequest() {
    }

    public UpdateAlertRequest(SettableAlertState state) {
        this.state = state;
    }

    public SettableAlertState getState() {
        return state;
    }

    public void setState(SettableAlertState state) {
        this.state = state;
    }

    @JsonAnySetter
    void rejectUnknown(String property, Object value) {
        throw new IllegalArgumentException("unknown property: " + property);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof UpdateAlertRequest other && state == other.state;
    }

    @Override
    public int hashCode() {
        return Objects.hash(state);
    }
}
