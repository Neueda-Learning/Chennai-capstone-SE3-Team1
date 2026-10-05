package com.team1.executor.error;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class RetryHandler {
    
    private static final Logger log = LoggerFactory.getLogger(RetryHandler.class);
    
    private final long baseDelayMs;
    private final double backoffMultiplier;

    public RetryHandler(
            @Value("${executor.retry.base-delay-ms:1000}") long baseDelayMs,
            @Value("${executor.retry.backoff-multiplier:2.0}") double backoffMultiplier) {
        this.baseDelayMs = Math.max(1, baseDelayMs);
        this.backoffMultiplier = Math.max(1.0, backoffMultiplier);
    }

    public void sleepBeforeRetry(ErrorContext errorContext) throws InterruptedException {
        long delayMs = calculateBackoffMs(errorContext.attemptCount());
        
        log.info("Retrying message after {} attempt(s). Sleeping for {}ms before next attempt.",
            errorContext.attemptCount(), delayMs);
        
        Thread.sleep(delayMs);
    }

    public long calculateBackoffMs(int attemptNumber) {
        return Math.round(baseDelayMs * Math.pow(backoffMultiplier, attemptNumber - 1));
    }

    public boolean shouldRetry(ErrorContext errorContext) {
        return errorContext.shouldRetry();
    }
}
