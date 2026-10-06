package com.team1.trading.api.watchlists;

import com.team1.trading.domain.exception.DomainException;

public class WatchlistLimitException extends DomainException {

    public static final String CODE = "WLT-429";

    public WatchlistLimitException(String message) {
        super(CODE, message);
    }
}
