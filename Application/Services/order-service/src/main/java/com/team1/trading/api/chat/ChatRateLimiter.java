package com.team1.trading.api.chat;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Every message costs money (and free-tier quota), so each account gets a fixed number per window.
 * In memory: with more than one instance each keeps its own count, which only makes the limit looser.
 */
@Component
public class ChatRateLimiter {

    private final int maxMessages;
    private final long windowMillis;
    private final Clock clock;
    private final Map<Long, Deque<Long>> sent = new ConcurrentHashMap<>();

    @Autowired
    public ChatRateLimiter(@Value("${chat.rate-limit.messages:20}") int maxMessages,
                           @Value("${chat.rate-limit.window-seconds:300}") int windowSeconds) {
        this(maxMessages, windowSeconds, Clock.systemUTC());
    }

    ChatRateLimiter(int maxMessages, int windowSeconds, Clock clock) {
        this.maxMessages = maxMessages;
        this.windowMillis = windowSeconds * 1_000L;
        this.clock = clock;
    }

    /** Counts one message for the account, or throws if it has used its allowance. */
    public void acquire(long accountId) {
        long now = clock.millis();
        Deque<Long> times = sent.computeIfAbsent(accountId, id -> new ArrayDeque<>());
        synchronized (times) {
            for (Iterator<Long> it = times.iterator(); it.hasNext() && now - it.next() >= windowMillis; ) {
                it.remove();
            }
            if (times.size() >= maxMessages) {
                throw ChatException.rateLimited();
            }
            times.addLast(now);
        }
    }
}
