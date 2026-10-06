package com.team1.trading.api.notifications;

import com.team1.trading.api.dto.TransferDirection;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
class TransferNotifierTest {

    @Mock
    private NotificationRecorder recorder;
    @Mock
    private NotificationDispatcher dispatcher;

    private TransferNotifier notifier;

    @BeforeEach
    void setUp() {
        notifier = new TransferNotifier(recorder, dispatcher, "INR");
    }

    @AfterEach
    void tearDown() {
        notifier.stop();
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    @DisplayName("A deposit is recorded as TRANSFER_IN under a transfer-specific event id, then dispatched at once")
    void depositIsRecordedAndDispatched() {
        given(recorder.record(eq("transfer-t-1"), eq(7L), eq(NotificationKind.TRANSFER_IN), anyString()))
                .willReturn(new NotificationRecorder.Recorded(NotificationStatus.QUEUED, true));

        notifier.transferCompleted("t-1", 7L, TransferDirection.BANK_TO_WALLET, new BigDecimal("250.00"));

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(recorder).record(eq("transfer-t-1"), eq(7L), eq(NotificationKind.TRANSFER_IN), payload.capture());
        assertThat(payload.getValue()).contains("\"amount\":\"250.00\"").contains("\"currency\":\"INR\"");
        verify(dispatcher).dispatchSoon();
    }

    @Test
    @DisplayName("A withdrawal is recorded as TRANSFER_OUT")
    void withdrawalIsTransferOut() {
        given(recorder.record(anyString(), anyLong(), any(), anyString()))
                .willReturn(new NotificationRecorder.Recorded(NotificationStatus.PENDING_CHANNEL, true));

        notifier.transferCompleted("t-2", 7L, TransferDirection.WALLET_TO_BANK, new BigDecimal("40.50"));

        verify(recorder).record(eq("transfer-t-2"), eq(7L), eq(NotificationKind.TRANSFER_OUT), anyString());
        verify(dispatcher, never()).dispatchSoon(); // no channel yet: the rescan will promote it
    }

    @Test
    @DisplayName("A notification failure never reaches the transfer")
    void failureIsSwallowed() {
        given(recorder.record(anyString(), anyLong(), any(), anyString()))
                .willThrow(new IllegalStateException("database down"));

        notifier.transferCompleted("t-3", 7L, TransferDirection.BANK_TO_WALLET, new BigDecimal("1.00"));

        verifyNoInteractions(dispatcher);
    }

    @Test
    @DisplayName("Inside a transaction nothing is recorded until it commits, and then not on the committing thread")
    void waitsForCommit() {
        given(recorder.record(anyString(), anyLong(), any(), anyString()))
                .willReturn(new NotificationRecorder.Recorded(NotificationStatus.QUEUED, true));
        TransactionSynchronizationManager.initSynchronization();

        notifier.transferCompleted("t-4", 7L, TransferDirection.BANK_TO_WALLET, new BigDecimal("5.00"));

        verifyNoInteractions(recorder);
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        verify(recorder, timeout(2_000)).record(eq("transfer-t-4"), eq(7L), eq(NotificationKind.TRANSFER_IN), anyString());
    }

    @Test
    @DisplayName("A transfer whose transaction rolls back is never announced")
    void rollbackAnnouncesNothing() throws Exception {
        TransactionSynchronizationManager.initSynchronization();

        notifier.transferCompleted("t-5", 7L, TransferDirection.BANK_TO_WALLET, new BigDecimal("5.00"));
        TransactionSynchronizationManager.getSynchronizations()
                .forEach(sync -> sync.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));
        Thread.sleep(200);

        verifyNoInteractions(recorder);
    }
}
