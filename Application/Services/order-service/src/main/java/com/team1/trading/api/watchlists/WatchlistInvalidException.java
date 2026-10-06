package com.team1.trading.api.watchlists;

import com.team1.trading.domain.exception.DomainException;

public class WatchlistInvalidException extends DomainException {

    public static final String CODE = "WLT-422";

    public WatchlistInvalidException(String message) {
        super(CODE, message);
    }
}
