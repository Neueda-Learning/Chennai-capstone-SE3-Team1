package com.team1.trading.api.conditional;

import com.team1.trading.domain.exception.DomainException;

public class ConditionInvalidException extends DomainException {

    public static final String CODE = "COND-422";

    public ConditionInvalidException(String message) {
        super(CODE, message);
    }
}
