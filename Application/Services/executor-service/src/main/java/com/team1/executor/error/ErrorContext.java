package com.team1.executor.error;

import java.time.Instant;
import java.util.Objects;

public record ErrorContext(
    ErrorCategory category,
    boolean isRetryable,
    int maxRetries,
    String failureReason,
    String failureDetails,
    String exceptionType,
    Instant firstFailureTime,
    int attemptCount
) {
    
    public ErrorContext {
        Objects.requireNonNull(category, "category must not be null");
        Objects.requireNonNull(failureReason, "failureReason must not be null");
        Objects.requireNonNull(exceptionType, "exceptionType must not be null");
        Objects.requireNonNull(firstFailureTime, "firstFailureTime must not be null");
        
        if (attemptCount < 1) {
            throw new IllegalArgumentException("attemptCount must be >= 1");
        }
        if (maxRetries < 0) {
            throw new IllegalArgumentException("maxRetries must be >= 0");
        }
    }

    public ErrorContext(
        ErrorCategory category,
        boolean isRetryable,
        int maxRetries,
        String failureReason,
        String failureDetails,
        String exceptionType
    ) {
        this(category, isRetryable, maxRetries, failureReason, failureDetails, 
             exceptionType, Instant.now(), 1);
    }

    public ErrorContext nextAttempt() {
        return new ErrorContext(
            category, isRetryable, maxRetries,
            failureReason, failureDetails, exceptionType,
            firstFailureTime, attemptCount + 1
        );
    }

    public boolean shouldRetry() {
        return isRetryable && attemptCount < maxRetries;
    }

    public boolean budgetExhausted() {
        return attemptCount >= maxRetries;
    }

    public long calculateBackoffMs(long baseDelayMs) {
        return baseDelayMs * (long) Math.pow(2, attemptCount - 1);
    }

    @Override
    public String toString() {
        return "ErrorContext{" +
            "category=" + category +
            ", isRetryable=" + isRetryable +
            ", attemptCount=" + attemptCount +
            ", maxRetries=" + maxRetries +
            ", failureReason='" + failureReason + '\'' +
            ", exceptionType='" + exceptionType + '\'' +
            '}';
    }
}
