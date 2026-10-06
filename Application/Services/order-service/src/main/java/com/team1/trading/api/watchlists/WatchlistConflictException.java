package com.team1.trading.api.watchlists;

import com.team1.trading.domain.exception.DomainException;

public class WatchlistConflictException extends DomainException {

    public static final String CODE = "WLT-409";

    public WatchlistConflictException(String message) {
        super(CODE, message);
    }
}
