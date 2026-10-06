package com.team1.trading.api.watchlists;

import com.team1.trading.domain.exception.DomainException;

public class WatchlistNotFoundException extends DomainException {

    public static final String CODE = "WLT-404";

    public WatchlistNotFoundException(String what) {
        super(CODE, what + " not found");
    }
}
