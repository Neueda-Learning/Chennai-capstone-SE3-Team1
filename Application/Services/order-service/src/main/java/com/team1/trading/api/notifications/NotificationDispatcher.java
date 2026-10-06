package com.team1.trading.api.notifications;

import com.team1.trading.api.notifications.NotificationLedgerMapper.LedgerRow;
import com.team1.trading.api.preferences.ChannelKind;
import com.team1.trading.api.preferences.PreferenceResolutionException;
import com.team1.trading.api.preferences.PreferenceResolver;
import com.team1.trading.api.preferences.ResolvedChannel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Optional;

@Component
public class NotificationDispatcher {

    static final int BATCH = 100;
    static final String CHANNEL_ERROR = "CHANNEL_ERROR";

    private static final Logger log = LoggerFactory.getLogger(NotificationDispatcher.class);

    private final NotificationLedgerMapper mapper;
    private final PreferenceResolver resolver;
    private final ChannelSender sender;

    public NotificationDispatcher(NotificationLedgerMapper mapper, PreferenceResolver resolver, ChannelSender sender) {
        this.mapper = mapper;
        this.resolver = resolver;
        this.sender = sender;
    }

    @Scheduled(fixedDelayString = "${notifications.dispatch.interval-ms:5000}")
    public void dispatchQueued() {
        try {
            for (LedgerRow row : mapper.findByStatus(NotificationStatus.QUEUED.name(), BATCH)) {
                dispatch(row);
            }
        } catch (DataAccessException e) {
            log.error("Dispatch pass could not read the ledger; it will run again", e);
        }
    }

    @Scheduled(fixedDelayString = "${notifications.rescan.interval-ms:60000}")
    public void rescanPending() {
        try {
            for (LedgerRow row : mapper.findByStatus(NotificationStatus.PENDING_CHANNEL.name(), BATCH)) {
                promote(row);
            }
        } catch (DataAccessException e) {
            log.error("Pending-channel rescan could not read the ledger; it will run again", e);
        }
    }

    private void promote(LedgerRow row) {
        Optional<ResolvedChannel> channel;
        try {
            channel = resolver.resolve(row.getAccountId());
        } catch (PreferenceResolutionException e) {
            log.warn("Pending notification {} still has no resolvable channel", row.getId());
            return;
        }
        if (channel.isPresent()) {
            mapper.markQueued(row.getId(), channel.get().kind().name(), channel.get().address());
        }
    }

    private void dispatch(LedgerRow row) {
        try {
            NotificationKind kind = NotificationKind.valueOf(row.getKind());
            sender.send(ChannelKind.valueOf(row.getChannel()), row.getAddress(), MessageComposer.subject(kind),
                    MessageComposer.message(kind, row.getPayload()));
        } catch (ChannelDeliveryException e) {
            log.warn("Notification {} was refused by its channel: {}", row.getId(), e.getCode());
            mapper.markFailed(row.getId(), e.getCode());
            return;
        } catch (RuntimeException e) {
            log.warn("Notification {} could not be handed to its channel", row.getId(), e);
            mapper.markFailed(row.getId(), CHANNEL_ERROR);
            return;
        }
        mapper.markSent(row.getId(), LocalDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.MICROS));
    }
}
