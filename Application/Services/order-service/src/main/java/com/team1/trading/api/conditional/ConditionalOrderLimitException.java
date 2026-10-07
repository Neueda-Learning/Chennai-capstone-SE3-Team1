package com.team1.trading.api.conditional;

import com.team1.trading.domain.exception.DomainException;

public class ConditionalOrderLimitException extends DomainException {

    public static final String CODE = "COND-429";

    public ConditionalOrderLimitException(String message) {
        super(CODE, message);
    }
}
