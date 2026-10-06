package com.team1.trading.api.notifications;

import com.team1.trading.api.preferences.ChannelKind;

public interface ChannelSender {

    /** Hands the message to the channel, or throws {@link ChannelDeliveryException} with a short failure code. */
    void send(ChannelKind kind, String address, String subject, String body);
}
