package com.team1.trading.api.exception;

import com.team1.trading.domain.exception.DomainException;

public class BankAccountLinkConflictException extends DomainException {

    public static final String CODE = ErrorCatalogue.ACC_409;
    public static final String MESSAGE = "Bank account could not be linked";

    public enum Reason {
        USER_ALREADY_LINKED,
        ACCOUNT_ALREADY_CLAIMED,
        ALREADY_ON_FILE
    }

    private final Reason reason;

    public BankAccountLinkConflictException(Reason reason) {
        super(CODE, MESSAGE);
        this.reason = reason;
    }

    public Reason getReason() {
        return reason;
    }
}
