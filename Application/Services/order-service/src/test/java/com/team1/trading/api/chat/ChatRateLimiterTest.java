package com.team1.trading.api.chat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ChatRateLimiterTest {

    private final AtomicLong now = new AtomicLong(1_000_000L);
    private final Clock clock = new Clock() {
        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return Instant.ofEpochMilli(now.get());
        }
    };

    @Test
    @DisplayName("An account may send its allowance within the window, and the next message is refused")
    void limit() {
        ChatRateLimiter limiter = new ChatRateLimiter(3, 60, clock);

        assertThatCode(() -> {
            limiter.acquire(1L);
            limiter.acquire(1L);
            limiter.acquire(1L);
        }).doesNotThrowAnyException();
        assertThatThrownBy(() -> limiter.acquire(1L))
                .isInstanceOf(ChatException.class)
                .hasFieldOrPropertyWithValue("code", "CHT-429");
    }

    @Test
    @DisplayName("Allowance returns as the window moves on")
    void windowSlides() {
        ChatRateLimiter limiter = new ChatRateLimiter(2, 60, clock);
        limiter.acquire(1L);
        now.addAndGet(30_000);
        limiter.acquire(1L);
        assertThatThrownBy(() -> limiter.acquire(1L)).isInstanceOf(ChatException.class);

        now.addAndGet(31_000); // the first message is now 61s old
        assertThatCode(() -> limiter.acquire(1L)).doesNotThrowAnyException();
        assertThatThrownBy(() -> limiter.acquire(1L)).isInstanceOf(ChatException.class);
    }

    @Test
    @DisplayName("Accounts are counted separately")
    void perAccount() {
        ChatRateLimiter limiter = new ChatRateLimiter(1, 60, clock);
        limiter.acquire(1L);

        assertThatCode(() -> limiter.acquire(2L)).doesNotThrowAnyException();
        assertThatThrownBy(() -> limiter.acquire(1L)).isInstanceOf(ChatException.class);
    }
}
