package com.team1.trading.api.preferences;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ResolvedChannelTest {

    @Test
    @DisplayName("toString never prints the address")
    void toStringMasksAddress() {
        ResolvedChannel channel = new ResolvedChannel(ChannelKind.PUSH, "someone@example.com");

        assertThat(channel.toString()).doesNotContain("someone").doesNotContain("example.com");
        assertThat(channel.toString()).contains("PUSH");
    }

    @Test
    @DisplayName("A blank or null address is refused at construction")
    void blankAddressRefused() {
        assertThatThrownBy(() -> new ResolvedChannel(ChannelKind.PUSH, " ")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ResolvedChannel(ChannelKind.PUSH, null)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("Equality still works on the real address")
    void equalityUsesAddress() {
        assertThat(new ResolvedChannel(ChannelKind.PUSH, "a@example.com"))
                .isEqualTo(new ResolvedChannel(ChannelKind.PUSH, "a@example.com"))
                .isNotEqualTo(new ResolvedChannel(ChannelKind.PUSH, "b@example.com"));
    }
}
