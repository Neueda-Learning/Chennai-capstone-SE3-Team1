package com.team1.trading.api.exception;

import com.team1.trading.domain.exception.DomainException;

/**
 * A transfer between the wallet and the linked bank account was refused. The code and message
 * are fixed per case; the amounts and balances involved are logged on the server only.
 */
public class TransferException extends DomainException {

    public enum Reason {
        /** The side being debited cannot cover the amount: {@code TRF-400}. */
        INSUFFICIENT_FUNDS(ErrorCatalogue.TRF_400, "Insufficient funds"),
        /** The idempotency key was already used by an earlier transfer: {@code TRF-409}. */
        DUPLICATE_TRANSFER(ErrorCatalogue.TRF_409, "Duplicate transfer");

        private final String code;
        private final String message;

        Reason(String code, String message) {
            this.code = code;
            this.message = message;
        }
    }

    private final Reason reason;
    private final Long accountId;
    private final String detail;

    public TransferException(Reason reason, Long accountId, String detail) {
        super(reason.code, reason.message);
        this.reason = reason;
        this.accountId = accountId;
        this.detail = detail;
    }

    public Reason getReason() {
        return reason;
    }

    public Long getAccountId() {
        return accountId;
    }

    public String getDetail() {
        return detail;
    }
}
