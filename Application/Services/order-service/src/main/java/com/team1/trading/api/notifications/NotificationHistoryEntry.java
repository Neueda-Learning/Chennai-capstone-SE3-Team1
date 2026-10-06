package com.team1.trading.api.notifications;

import com.team1.trading.api.preferences.ChannelKind;

import java.time.OffsetDateTime;
import java.util.UUID;

public record NotificationHistoryEntry(
        UUID id,
        NotificationKind kind,
        String message,
        ChannelKind channel,
        NotificationStatus status,
        OffsetDateTime createdAt,
        OffsetDateTime deliveredAt
) {
}
