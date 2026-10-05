package com.team1.trading.api.exception;

import com.team1.trading.domain.exception.DomainException;

public class EmailInUseException extends DomainException {

    public static final String MESSAGE = "Email already in use";

    private final Long clientId;

    public EmailInUseException(Long clientId) {
        super(ErrorCatalogue.ACC_409, MESSAGE);
        this.clientId = clientId;
    }

    public Long getClientId() {
        return clientId;
    }
}
