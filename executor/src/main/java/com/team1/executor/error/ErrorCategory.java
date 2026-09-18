package com.team1.executor.error;

/**
 * Classification of error types for retry/dead-letter decisions.
 * 
 * Used by ErrorClassifier to categorize exceptions and determine
 * whether to retry with backoff or dead-letter immediately.
 */
public enum ErrorCategory {
    /**
     * Malformed message structure: JSON parse errors, missing required fields.
     * DEAD-LETTER immediately: will fail on every retry.
     * Recovery: Fix schema/producer, replay from DLT.
     */
    MALFORMED_MESSAGE,

    /**
     * Order not found in Postgres. May indicate:
     * - Already processed (replay scenario)
     * - Order never existed (API issue)
     * - Database consistency issue
     * DEAD-LETTER immediately: order state is definitive.
     * Recovery: Investigate Postgres; if already settled, won't re-process.
     */
    ORDER_NOT_FOUND,

    /**
     * Account not found in Postgres. Indicates:
     * - Account was deleted after order was created
     * - Account ID mismatch
     * DEAD-LETTER immediately: account lookup won't succeed on retry.
     * Recovery: Investigate account state.
     */
    ACCOUNT_NOT_FOUND,

    /**
     * Instrument not found or not tradable.
     * DEAD-LETTER immediately: instrument state is deterministic.
     * Recovery: Fix instrument master data, replay if needed.
     */
    INSTRUMENT_NOT_TRADABLE,

    /**
     * Quote fetch failed due to transient network issue.
     * RETRY with backoff: Fauxnance may recover between attempts.
     * Examples: SocketTimeoutException, ConnectException, temporary 503.
     */
    QUOTE_FETCH_TRANSIENT,

    /**
     * Quote fetch failed due to permanent client error.
     * DO NOT RETRY or DEAD-LETTER: Instead, REJECT ORDER.
     * Examples: HTTP 429 (quota), HTTP 404 (bad symbol), HTTP 400 (bad range).
     * Rationale: Dead-lettering would leave order at NEW forever.
     * Recovery: User resubmits with valid parameters.
     */
    QUOTE_FETCH_PERMANENT,

    /**
     * Business-rule rejection that should produce ORDER_REJECTED (not retry, not DLT).
     * Examples: insufficient funds, insufficient holdings.
     */
    REJECT_ORDER,

    /**
     * Account exists but is not tradable (SUSPENDED/CLOSED/TOKEN mismatch).
     * DEAD-LETTER immediately: deterministic until account state changes externally.
     */
    ACCOUNT_NOT_ACTIVE,

    /**
     * Database connection issue: pool exhausted, network timeout, connection refused.
     * RETRY with backoff: Connection pool may recover between attempts.
     * Examples: CannotGetJdbcConnectionException, SQLException with connection errors.
     */
    DATABASE_CONNECTION_ERROR,

    /**
     * Optimistic locking failure: concurrent account updates exceeded retry budget.
     * RETRY with backoff: Contention may reduce on retry.
     * Note: SettlementService already retries internally (3x);
     *       outer retry gives additional chances.
     */
    LOCK_BUDGET_EXHAUSTED,

    /**
     * Unknown/unexpected error. Conservative: treat as RETRY.
     * Rationale: Prefer to retry than risk losing data by dead-lettering.
     * Recovery: Manual investigation of error logs.
     */
    UNKNOWN_ERROR
}
