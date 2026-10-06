package com.team1.trading.api.watchlists;

import com.team1.trading.api.notifications.DeliveryOutcome;

public enum AlertDeliveryState {
    QUEUED, PENDING_CHANNEL, REJECTED, DELIVERY_FAILED;

    static AlertDeliveryState of(DeliveryOutcome outcome) {
        return switch (outcome) {
            case QUEUED -> QUEUED;
            case PENDING_CHANNEL -> PENDING_CHANNEL;
            case REJECTED -> REJECTED;
        };
    }
}
