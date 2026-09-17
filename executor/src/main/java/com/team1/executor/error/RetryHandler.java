package com.team1.executor.error;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Manages retry logic with exponential backoff.
 * 
 * Retry strategy:
 * - Attempt 1: immediate
 * - Attempt 2: wait baseDelayMs * 2^0 = 1s
 * - Attempt 3: wait baseDelayMs * 2^1 = 2s
 * - Attempt 4: wait baseDelayMs * 2^2 = 4s
 * 
 * Total delay budget for 3 attempts: 1s + 2s = 3s total wait time
 * 
 * Thread-safe and stateless.
 */
@Component
public class RetryHandler {
    
    private static final Logger log = LoggerFactory.getLogger(RetryHandler.class);
    
    private final long baseDelayMs;
    private final double backoffMultiplier;

    public RetryHandler(
            @Value("${executor.retry.base-delay-ms:1000}") long baseDelayMs,
            @Value("${executor.retry.backoff-multiplier:2.0}") double backoffMultiplier) {
        this.baseDelayMs = Math.max(1, baseDelayMs);  // At least 1ms
        this.backoffMultiplier = Math.max(1.0, backoffMultiplier);  // At least 1.0
    }

    /**
     * Sleeps for the calculated backoff duration before retry.
     * 
     * Formula: baseDelayMs * (backoffMultiplier ^ attemptNumber)
     * 
     * Example with baseDelayMs=1000, multiplier=2.0:
     *   attempt 1 fails → sleep 1000ms
     *   attempt 2 fails → sleep 2000ms
     *   attempt 3 fails → ready for dead-letter (no more sleep)
     * 
     * @param errorContext The error context with attempt count
     * @throws InterruptedException if sleep is interrupted
     */
    public void sleepBeforeRetry(ErrorContext errorContext) throws InterruptedException {
        long delayMs = calculateBackoffMs(errorContext.attemptCount());
        
        log.info("Retrying message after {} attempt(s). Sleeping for {}ms before next attempt.",
            errorContext.attemptCount(), delayMs);
        
        Thread.sleep(delayMs);
    }

    /**
     * Calculates milliseconds to wait using exponential backoff.
     * 
     * Formula: baseDelayMs * (multiplier ^ attemptNumber - 1)
     * 
     * @param attemptNumber The current attempt number (1-based)
     * @return Milliseconds to wait before next retry
     */
    public long calculateBackoffMs(int attemptNumber) {
        // Attempt 1 → wait baseDelayMs * (2^0) = baseDelayMs
        // Attempt 2 → wait baseDelayMs * (2^1) = baseDelayMs * 2
        // Attempt 3 → wait baseDelayMs * (2^2) = baseDelayMs * 4
        return Math.round(baseDelayMs * Math.pow(backoffMultiplier, attemptNumber - 1));
    }

    /**
     * Returns true if retry should proceed (attempt < maxRetries).
     * 
     * @param errorContext The error context with current state
     * @return true if should retry, false if budget exhausted
     */
    public boolean shouldRetry(ErrorContext errorContext) {
        return errorContext.shouldRetry();
    }
}
