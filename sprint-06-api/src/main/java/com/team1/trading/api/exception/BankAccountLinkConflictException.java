package com.team1.trading.api.exception;

import com.team1.trading.domain.exception.DomainException;

/**
 * A bank account could not be linked because something it needs is already taken:
 * {@code ACC-409}. The client always sees the same message; which of the reasons applied is
 * logged on the server only, so the endpoint cannot be used to probe whose account number or
 * email is on file.
 */
public class BankAccountLinkConflictException extends DomainException {

    public static final String CODE = ErrorCatalogue.ACC_409;
    public static final String MESSAGE = "Bank account could not be linked";

    public enum Reason {
        /** The user already has a linked trading account. */
        USER_ALREADY_LINKED,
        /** The bank account number, or the user's email, is already held by another client. */
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
