package com.team1.trading.api.notifications;

import com.team1.trading.api.notifications.NotificationLedgerMapper.LedgerRow;
import com.team1.trading.api.preferences.PreferenceResolver;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class NotificationRecorderRaceTest {

    @Test
    @DisplayName("Losing a race on UNIQUE(event_id) is a replay, not an error")
    void duplicateKeyIsAReplay() {
        NotificationLedgerMapper mapper = mock(NotificationLedgerMapper.class);
        PreferenceResolver resolver = mock(PreferenceResolver.class);
        PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
        when(tx.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(resolver.resolve(1L)).thenReturn(Optional.empty());
        LedgerRow winner = new LedgerRow();
        winner.setStatus("SENT");
        when(mapper.findByEventId("ev")).thenReturn(Optional.empty(), Optional.of(winner));
        when(mapper.insert(any())).thenThrow(new DuplicateKeyException("uq_notifications_event_id"));

        NotificationRecorder.Recorded recorded = new NotificationRecorder(mapper, resolver, tx)
                .record("ev", 1L, NotificationKind.ORDER_FILLED, "{}");

        assertThat(recorded).isEqualTo(new NotificationRecorder.Recorded(NotificationStatus.SENT, false));
    }
}
