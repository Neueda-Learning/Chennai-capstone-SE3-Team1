package com.team1.trading.api.preferences;

public record ResolvedChannel(ChannelKind kind, String address) {

    public ResolvedChannel {
        if (kind == null) {
            throw new IllegalArgumentException("kind must not be null");
        }
        if (address == null || address.isBlank()) {
            throw new IllegalArgumentException("address must be non-blank");
        }
    }

    @Override
    public String toString() {
        return "ResolvedChannel[kind=" + kind + ", address=***]";
    }
}
