package com.team1.trading.api.notifications;

public class ChannelDeliveryException extends RuntimeException {

    private final String code;

    public ChannelDeliveryException(String code) {
        super(code);
        this.code = code;
    }

    public ChannelDeliveryException(String code, Throwable cause) {
        super(code, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
