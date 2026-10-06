package com.team1.trading.api.notifications;

public interface NotificationDelivery {

    /**
     * Hand a triggered price alert to Notifications. Keyed on {@code alert.deliveryId()}: a replay
     * returns the outcome for the row already written and writes nothing. Business reasons (unknown
     * account, no stored preference) are outcomes, never exceptions; only an infrastructure failure
     * raises {@link NotificationDeliveryException}.
     */
    DeliveryOutcome deliver(AlertNotification alert);
}
