package com.team1.trading.api.preferences;

import com.team1.trading.domain.exception.DomainException;

public class PreferencesInvalidException extends DomainException {

    public static final String CODE = "PRF-422";

    public PreferencesInvalidException(String message) {
        super(CODE, message);
    }
}
