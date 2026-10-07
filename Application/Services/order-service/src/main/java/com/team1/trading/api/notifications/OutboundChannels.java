package com.team1.trading.api.notifications;

import com.team1.trading.api.preferences.ChannelKind;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class OutboundChannels implements ChannelSender {

    private static final Logger log = LoggerFactory.getLogger(OutboundChannels.class);

    @Override
    public void send(ChannelKind kind, String address, String subject, String body) {
        switch (kind) {
            case PUSH -> log.debug("Push message for the in-app inbox recorded");
        }
    }
}
