package com.team1.executor.error;

import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.team1.executor.quote.FauxnanceQuoteClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.jdbc.CannotGetJdbcConnectionException;

import org.springframework.stereotype.Component;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.sql.SQLException;

@Component
public class ErrorClassifier {
    
    private static final Logger log = LoggerFactory.getLogger(ErrorClassifier.class);
    
    private final int maxRetries;
    
    public ErrorClassifier(@Value("${executor.retry.max-attempts:3}") int maxRetries) {
        this.maxRetries = Math.max(1, maxRetries);
    }

    public ErrorContext classify(Exception exception, String context) {
        if (exception == null) {
            exception = new RuntimeException("Unknown exception");
        }

        String exceptionType = exception.getClass().getName();
        String failureDetails = exception.getMessage() != null ? 
            exception.getMessage() : "No message provided";

        if (exception instanceof JsonParseException || 
            exception instanceof JsonMappingException) {
            log.warn("Malformed message detected ({}): {}", context, failureDetails);
            return new ErrorContext(
                ErrorCategory.MALFORMED_MESSAGE,
                false,
                0,
                "MALFORMED_JSON",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof NullPointerException) {
            log.warn("Missing required field detected ({}): {}", context, failureDetails);
            return new ErrorContext(
                ErrorCategory.MALFORMED_MESSAGE,
                false,
                0,
                "MISSING_REQUIRED_FIELD",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof IllegalArgumentException && 
            failureDetails != null && failureDetails.contains("ORDER_NOT_FOUND")) {
            log.warn("Order not found in database: {}", failureDetails);
            return new ErrorContext(
                ErrorCategory.ORDER_NOT_FOUND,
                false,
                0,
                "ORDER_NOT_FOUND",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof IllegalArgumentException && 
            failureDetails != null && failureDetails.contains("ACCOUNT_NOT_FOUND")) {
            log.warn("Account not found in database: {}", failureDetails);
            return new ErrorContext(
                ErrorCategory.ACCOUNT_NOT_FOUND,
                false,
                0,
                "ACCOUNT_NOT_FOUND",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof IllegalArgumentException && 
            failureDetails != null && (failureDetails.contains("INSTRUMENT_NOT_FOUND") || 
                                       failureDetails.contains("INSTRUMENT_NOT_TRADABLE"))) {
            log.warn("Instrument issue detected: {}", failureDetails);
            return new ErrorContext(
                ErrorCategory.INSTRUMENT_NOT_TRADABLE,
                false,
                0,
                "INSTRUMENT_NOT_TRADABLE",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof FauxnanceQuoteClient.QuotaExhausted) {
            log.warn("Fauxnance quota exhausted (won't recover by retry): {}", failureDetails);
            return new ErrorContext(
                ErrorCategory.QUOTE_FETCH_PERMANENT,
                false,
                0,
                "QUOTE_FETCH_QUOTA_EXHAUSTED",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof FauxnanceQuoteClient.BadRequest) {
            log.warn("Fauxnance bad request (won't recover by retry): {}", failureDetails);
            return new ErrorContext(
                ErrorCategory.QUOTE_FETCH_PERMANENT,
                false,
                0,
                "QUOTE_FETCH_BAD_REQUEST",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof SocketTimeoutException) {
            log.warn("Quote fetch timeout (retryable): {}", failureDetails);
            return new ErrorContext(
                ErrorCategory.QUOTE_FETCH_TRANSIENT,
                true,
                maxRetries,
                "QUOTE_FETCH_TIMEOUT",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof ConnectException) {
            log.warn("Quote fetch connection error (retryable): {}", failureDetails);
            return new ErrorContext(
                ErrorCategory.QUOTE_FETCH_TRANSIENT,
                true,
                maxRetries,
                "QUOTE_FETCH_CONNECTION_ERROR",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof FauxnanceQuoteClient.ServiceUnreachable) {
            log.warn("Fauxnance service unreachable (retryable): {}", failureDetails);
            return new ErrorContext(
                ErrorCategory.QUOTE_FETCH_TRANSIENT,
                true,
                maxRetries,
                "QUOTE_FETCH_SERVICE_UNREACHABLE",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof CannotGetJdbcConnectionException) {
            log.warn("Cannot get JDBC connection (retryable): {}", failureDetails);
            return new ErrorContext(
                ErrorCategory.DATABASE_CONNECTION_ERROR,
                true,
                maxRetries,
                "DATABASE_CONNECTION_POOL_EXHAUSTED",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof SQLException) {
            log.warn("SQL error (retryable): {}", failureDetails);
            return new ErrorContext(
                ErrorCategory.DATABASE_CONNECTION_ERROR,
                true,
                maxRetries,
                "DATABASE_SQL_ERROR",
                failureDetails,
                exceptionType
            );
        }

        if (exception instanceof OptimisticLockingFailureException) {
            log.warn("Optimistic lock exhausted (retryable): {}", failureDetails);
            return new ErrorContext(
                ErrorCategory.LOCK_BUDGET_EXHAUSTED,
                true,
                maxRetries,
                "LOCK_BUDGET_EXHAUSTED",
                failureDetails,
                exceptionType
            );
        }

        log.warn("Unknown error detected, will retry ({}): {} - {}", 
            context, exceptionType, failureDetails);
        return new ErrorContext(
            ErrorCategory.UNKNOWN_ERROR,
            true,
            maxRetries,
            "UNKNOWN_ERROR",
            failureDetails,
            exceptionType
        );
    }
}
