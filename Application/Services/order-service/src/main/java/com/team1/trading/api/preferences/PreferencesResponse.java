package com.team1.trading.api.preferences;

import java.time.LocalDateTime;

public record PreferencesResponse(
        Long accountId,
        Long defaultAccountId,
        ChannelKind channel,
        LocalDateTime updatedAt) {
}
