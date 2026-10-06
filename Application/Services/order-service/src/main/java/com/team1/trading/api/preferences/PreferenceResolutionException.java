package com.team1.trading.api.preferences;

public class PreferenceResolutionException extends RuntimeException {

    public PreferenceResolutionException(String message) {
        super(message);
    }

    public PreferenceResolutionException(String message, Throwable cause) {
        super(message, cause);
    }
}
