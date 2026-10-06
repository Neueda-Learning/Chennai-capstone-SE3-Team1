package com.team1.trading.api.preferences;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotNull;

import java.util.Objects;

public class PreferencesRequest {

    @NotNull
    private Long defaultAccountId;

    @NotNull
    private ChannelKind channel;

    public PreferencesRequest() {
    }

    public PreferencesRequest(Long defaultAccountId, ChannelKind channel) {
        this.defaultAccountId = defaultAccountId;
        this.channel = channel;
    }

    public Long defaultAccountId() {
        return defaultAccountId;
    }

    public ChannelKind channel() {
        return channel;
    }

    public Long getDefaultAccountId() {
        return defaultAccountId;
    }

    public void setDefaultAccountId(Long defaultAccountId) {
        this.defaultAccountId = defaultAccountId;
    }

    public ChannelKind getChannel() {
        return channel;
    }

    public void setChannel(ChannelKind channel) {
        this.channel = channel;
    }

    @JsonAnySetter
    void rejectUnknown(String name, Object value) {
        throw new IllegalArgumentException("unknown property: " + name);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof PreferencesRequest other
                && Objects.equals(defaultAccountId, other.defaultAccountId)
                && channel == other.channel;
    }

    @Override
    public int hashCode() {
        return Objects.hash(defaultAccountId, channel);
    }
}
