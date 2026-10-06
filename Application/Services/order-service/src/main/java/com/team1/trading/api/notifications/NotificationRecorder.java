package com.team1.trading.api.notifications;

import com.team1.trading.api.notifications.NotificationLedgerMapper.LedgerRow;
import com.team1.trading.api.preferences.PreferenceResolutionException;
import com.team1.trading.api.preferences.PreferenceResolver;
import com.team1.trading.api.preferences.ResolvedChannel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;

@Service
public class NotificationRecorder {

    public static final int ACCOUNT_CAP = 10_000;

    private static final Logger log = LoggerFactory.getLogger(NotificationRecorder.class);

    public record Recorded(NotificationStatus status, boolean created) {
    }

    private final NotificationLedgerMapper mapper;
    private final PreferenceResolver resolver;
    private final TransactionTemplate tx;

    public NotificationRecorder(NotificationLedgerMapper mapper, PreferenceResolver resolver,
                                PlatformTransactionManager transactionManager) {
        this.mapper = mapper;
        this.resolver = resolver;
        this.tx = new TransactionTemplate(transactionManager);
    }

    public boolean accountExists(long accountId) {
        return mapper.countAccount(accountId) > 0;
    }

    /**
     * Writes the notification for {@code eventId} unless one is already there. Resolves the channel at
     * this moment; no usable channel, or a failing resolver, records the row as PENDING_CHANNEL. A database
     * failure propagates so the caller can leave the Kafka offset uncommitted.
     */
    public Recorded record(String eventId, long accountId, NotificationKind kind, String payloadJson) {
        Optional<LedgerRow> existing = mapper.findByEventId(eventId);
        if (existing.isPresent()) {
            return replay(existing.get());
        }

        Optional<ResolvedChannel> channel = resolve(eventId, accountId);

        LedgerRow row = new LedgerRow();
        row.setId(UUID.randomUUID().toString());
        row.setEventId(eventId);
        row.setAccountId(accountId);
        row.setKind(kind.name());
        row.setPayload(payloadJson);
        row.setCreatedAt(LocalDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.MICROS));
        if (channel.isPresent()) {
            row.setStatus(NotificationStatus.QUEUED.name());
            row.setChannel(channel.get().kind().name());
            row.setAddress(channel.get().address());
        } else {
            row.setStatus(NotificationStatus.PENDING_CHANNEL.name());
        }

        try {
            tx.executeWithoutResult(status -> {
                mapper.insert(row);
                if (mapper.countForAccount(accountId) > ACCOUNT_CAP) {
                    mapper.pruneBeyond(accountId, ACCOUNT_CAP);
                }
            });
        } catch (DuplicateKeyException e) {
            return replay(mapper.findByEventId(eventId).orElseThrow(() -> e));
        }
        return new Recorded(NotificationStatus.valueOf(row.getStatus()), true);
    }

    private Optional<ResolvedChannel> resolve(String eventId, long accountId) {
        try {
            return resolver.resolve(accountId);
        } catch (PreferenceResolutionException e) {
            log.warn("Channel resolution failed for event {}; recording as PENDING_CHANNEL", eventId);
            return Optional.empty();
        }
    }

    private static Recorded replay(LedgerRow row) {
        return new Recorded(NotificationStatus.valueOf(row.getStatus()), false);
    }
}
