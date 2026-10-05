package com.team1.executor.error;

import java.time.Instant;
import java.util.Objects;

/**
 * Encapsulates error classification and retry/DLT decision for a single message.
 * 
 * Created by ErrorClassifier after catching an exception.
 * Used by OrderConsumer to decide: retry, dead-letter, or reject order.
 * 
 * Thread-safe and immutable.
 */
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

    /**
     * Creates new ErrorContext for initial error (attempt 1).
     * firstFailureTime is set to now.
     */
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

    /**
     * Creates a new ErrorContext for the next retry attempt.
     * Increments attemptCount but keeps firstFailureTime unchanged.
     */
    public ErrorContext nextAttempt() {
        return new ErrorContext(
            category, isRetryable, maxRetries,
            failureReason, failureDetails, exceptionType,
            firstFailureTime, attemptCount + 1
        );
    }

    /**
     * True if this error should be retried (attempt < maxRetries).
     */
    public boolean shouldRetry() {
        return isRetryable && attemptCount < maxRetries;
    }

    /**
     * True if retry budget is exhausted (attempt >= maxRetries).
     */
    public boolean budgetExhausted() {
        return attemptCount >= maxRetries;
    }

    /**
     * Returns milliseconds to wait before next retry using exponential backoff.
     * 
     * Formula: baseDelayMs * (2 ^ attemptNumber)
     * 
     * Example with baseDelayMs=1000:
     *   attempt 1 fails → wait 1000ms before attempt 2
     *   attempt 2 fails → wait 2000ms before attempt 3
     *   attempt 3 fails → ready for dead-letter
     */
    public long calculateBackoffMs(long baseDelayMs) {
        return baseDelayMs * (long) Math.pow(2, attemptCount - 1);
    }

    /**
     * String representation for logging.
     */
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
