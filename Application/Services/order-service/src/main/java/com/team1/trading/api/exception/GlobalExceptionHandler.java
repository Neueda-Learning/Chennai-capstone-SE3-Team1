package com.team1.trading.api.exception;

import com.team1.trading.api.dto.ErrorResponse;
import com.team1.trading.api.security.JwtAuthenticationException;
import com.team1.trading.domain.exception.AccountNotActiveException;
import com.team1.trading.domain.exception.AccountNotFoundException;
import com.team1.trading.domain.exception.AuthenticationException;
import com.team1.trading.domain.exception.DomainException;
import com.team1.trading.domain.exception.DuplicateOrderException;
import com.team1.trading.domain.exception.InstrumentNotFoundException;
import com.team1.trading.domain.exception.InsufficientFundsException;
import com.team1.trading.domain.exception.InsufficientHoldingsException;
import com.team1.trading.domain.exception.InvalidOrderException;
import com.team1.trading.domain.exception.OrderConflictException;
import com.team1.trading.domain.exception.OrderNotCancellableException;
import com.team1.trading.domain.exception.OrderNotFoundException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger LOG = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private static final String VALIDATION_MESSAGE = "Invalid input";
    private static final String INTERNAL_MESSAGE = "Internal error";

    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ErrorResponse> handleDomainException(DomainException e) {
        HttpStatus status = e instanceof OrderNotFoundException
                ? HttpStatus.NOT_FOUND
                : ErrorCatalogue.statusFor(e.getCode());
        LOG.warn("Rejected request [code={}] {}", e.getCode(), detailFor(e), e);
        return envelope(e.getCode(), e.getMessage(), status);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        LOG.warn("Request argument type mismatch name={} value={}", e.getName(), e.getValue(), e);
        return envelope(ErrorCatalogue.VAL_422, VALIDATION_MESSAGE, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadableBody(HttpMessageNotReadableException e) {
        LOG.warn("Request body could not be read: {}", e.getMostSpecificCause().getMessage());
        return envelope(ErrorCatalogue.VAL_422, VALIDATION_MESSAGE, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException e) {
        List<FieldError> fieldErrors = e.getBindingResult().getFieldErrors();
        LOG.warn("Request validation failed fieldErrors={} message={}", fieldErrors, e.getMessage(), e);
        return envelope(ErrorCatalogue.VAL_422, VALIDATION_MESSAGE, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    @ExceptionHandler(JwtAuthenticationException.class)
    public ResponseEntity<ErrorResponse> handleJwtAuthentication(JwtAuthenticationException e) {
        LOG.warn("JWT verification failed: {}", e.getMessage(), e);
        return envelope(ErrorCatalogue.AUTH_401, "Unauthorized", HttpStatus.UNAUTHORIZED);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception e) {
        LOG.error("Unhandled exception", e);
        return envelope(ErrorCatalogue.INTERNAL_500, INTERNAL_MESSAGE, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    private static ResponseEntity<ErrorResponse> envelope(String code, String message, HttpStatus status) {
        return ResponseEntity.status(status).body(new ErrorResponse(code, message));
    }

    private static String detailFor(DomainException e) {
        if (e instanceof AccountNotFoundException x) {
            return "accountId=" + x.getAccountId();
        }
        if (e instanceof AccountNotActiveException x) {
            return "accountId=" + x.getAccountId() + ", state=" + x.getAccountState();
        }
        if (e instanceof InstrumentNotFoundException x) {
            return "symbol=" + x.getSymbol();
        }
        if (e instanceof InsufficientFundsException x) {
            return "accountId=" + x.getAccountId()
                    + ", required=" + x.getRequired()
                    + ", available=" + x.getAvailable();
        }
        if (e instanceof InsufficientHoldingsException x) {
            return "accountId=" + x.getAccountId()
                    + ", symbol=" + x.getSymbol()
                    + ", requested=" + x.getRequested()
                    + ", held=" + x.getHeld();
        }
        if (e instanceof DuplicateOrderException x) {
            return "idempotencyKey=" + x.getIdempotencyKey();
        }
        if (e instanceof OrderNotFoundException x) {
            return "orderId=" + x.getOrderId();
        }
        if (e instanceof OrderNotCancellableException x) {
            return "orderId=" + x.getOrderId() + ", status=" + x.getStatus();
        }
        if (e instanceof OrderConflictException x) {
            return "reason=" + x.getReason();
        }
        if (e instanceof InvalidOrderException x) {
            return "field=" + x.getField() + ", rejectedValue=" + x.getRejectedValue();
        }
        if (e instanceof AuthenticationException x) {
            return "reason=" + x.getReason();
        }
        if (e instanceof BankAccountLinkConflictException x) {
            return "reason=" + x.getReason();
        }
        if (e instanceof EmailInUseException x) {
            return "clientId=" + x.getClientId();
        }
        if (e instanceof InvalidAmountException x) {
            return "amount=" + x.getAmount();
        }
        if (e instanceof TransferException x) {
            return "accountId=" + x.getAccountId() + ", reason=" + x.getReason() + ", " + x.getDetail();
        }
        return "exception=" + e.getClass().getSimpleName();
    }
}