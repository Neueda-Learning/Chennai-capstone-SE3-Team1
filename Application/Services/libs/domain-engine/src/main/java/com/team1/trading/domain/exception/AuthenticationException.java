package com.team1.trading.domain.exception;

public class AuthenticationException extends DomainException {

    public static final String CODE = "AUTH-401";
    public static final String MESSAGE = "Unauthorised";

    private final String reason;

    public AuthenticationException(String reason) {
        super(CODE, MESSAGE);
        this.reason = reason;
    }

    public String getReason() {
        return reason;
    }
}