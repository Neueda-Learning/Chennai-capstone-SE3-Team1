package com.team1.trading.api.notifications;

public class NotificationDeliveryException extends RuntimeException {

    public NotificationDeliveryException(String message, Throwable cause) {
        super(message, cause);
    }
}
