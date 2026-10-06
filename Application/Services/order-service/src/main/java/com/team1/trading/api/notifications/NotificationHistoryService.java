package com.team1.trading.api.notifications;

import com.team1.trading.api.notifications.NotificationLedgerMapper.LedgerRow;
import com.team1.trading.api.preferences.ChannelKind;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

@Service
public class NotificationHistoryService {

    static final int DEFAULT_LIMIT = 30;
    static final int MAX_LIMIT = 100;

    private final NotificationLedgerMapper mapper;

    public NotificationHistoryService(NotificationLedgerMapper mapper) {
        this.mapper = mapper;
    }

    public List<NotificationHistoryEntry> history(Long accountId, Integer limit, OffsetDateTime before) {
        int size = limit == null ? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, limit));
        LocalDateTime cursor = before == null ? null : before.withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime();
        return mapper.history(accountId, cursor, size).stream().map(NotificationHistoryService::toEntry).toList();
    }

    private static NotificationHistoryEntry toEntry(LedgerRow row) {
        NotificationKind kind = NotificationKind.valueOf(row.getKind());
        return new NotificationHistoryEntry(
                UUID.fromString(row.getId()),
                kind,
                MessageComposer.message(kind, row.getPayload()),
                row.getChannel() == null ? null : ChannelKind.valueOf(row.getChannel()),
                NotificationStatus.valueOf(row.getStatus()),
                row.getCreatedAt().atOffset(ZoneOffset.UTC),
                row.getDeliveredAt() == null ? null : row.getDeliveredAt().atOffset(ZoneOffset.UTC));
    }
}
