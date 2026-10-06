package com.team1.trading.api.preferences;

import com.team1.trading.domain.exception.DomainException;

public class PreferencesNotFoundException extends DomainException {

    public static final String CODE = "PRF-404";
    public static final String MESSAGE = "Preferences not set";

    public PreferencesNotFoundException() {
        super(CODE, MESSAGE);
    }
}
