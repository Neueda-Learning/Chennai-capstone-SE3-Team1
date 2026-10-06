package com.team1.trading.api.notifications;

public enum DeliveryOutcome {
    /** Row written, channel resolved, message queued for the outbound channel. */
    QUEUED,

    /** Row written, no usable channel. The scanner will send when the customer sets one. */
    PENDING_CHANNEL,

    /** Nothing written: the request was malformed or the account is unknown. */
    REJECTED
}
