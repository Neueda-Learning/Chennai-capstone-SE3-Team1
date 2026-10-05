package com.team1.trading.api.exception;

import com.team1.trading.domain.exception.DomainException;

import java.math.BigDecimal;

/**
 * An amount that is not a positive sum of money with at most two decimal places: {@code VAL-422}.
 */
public class InvalidAmountException extends DomainException {

    private final BigDecimal amount;

    public InvalidAmountException(BigDecimal amount) {
        super(ErrorCatalogue.VAL_422, "Invalid input");
        this.amount = amount;
    }

    public BigDecimal getAmount() {
        return amount;
    }
}
