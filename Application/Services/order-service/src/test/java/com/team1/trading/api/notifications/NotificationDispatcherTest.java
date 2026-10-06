package com.team1.trading.api.notifications;

import com.team1.trading.api.notifications.NotificationLedgerMapper.LedgerRow;
import com.team1.trading.api.preferences.ChannelKind;
import com.team1.trading.api.preferences.PreferenceResolver;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class NotificationDispatcherTest {

    private NotificationLedgerMapper mapper;
    private final List<String> sent = new CopyOnWriteArrayList<>();
    private final AtomicBoolean rowIsQueued = new AtomicBoolean(true);
    private NotificationDispatcher dispatcher;

    private static LedgerRow queuedRow() {
        LedgerRow row = new LedgerRow();
        row.setId("row-1");
        row.setAccountId(1L);
        row.setKind(NotificationKind.TRANSFER_IN.name());
        row.setChannel("EMAIL");
        row.setAddress("priya@example.com");
        row.setPayload(MessageComposer.transferPayload(true, new java.math.BigDecimal("100.00"), "INR"));
        row.setStatus("QUEUED");
        return row;
    }

    @BeforeEach
    void setUp() {
        mapper = mock(NotificationLedgerMapper.class);
        // A tiny stateful ledger: the row is QUEUED until markSent runs, as in the real table.
        when(mapper.findByStatus(anyString(), anyInt())).thenAnswer(call ->
                "QUEUED".equals(call.getArgument(0)) && rowIsQueued.get() ? List.of(queuedRow()) : List.of());
        when(mapper.markSent(anyString(), any())).thenAnswer(call -> {
            rowIsQueued.set(false);
            return 1;
        });
        ChannelSender sender = (ChannelKind kind, String address, String subject, String body) -> {
            sent.add(address + "|" + subject);
            try {
                Thread.sleep(50); // a slow SMTP send, long enough for two passes to overlap if they could
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };
        dispatcher = new NotificationDispatcher(mapper, mock(PreferenceResolver.class), sender);
    }

    @AfterEach
    void tearDown() {
        dispatcher.stop();
    }

    @Test
    @DisplayName("dispatchSoon sends a queued row without waiting for the poll")
    void dispatchSoonSendsAtOnce() throws Exception {
        dispatcher.dispatchSoon();

        awaitSent(1);
        assertThat(sent).containsExactly("priya@example.com|Money added to your wallet");
    }

    @Test
    @DisplayName("A prompt dispatch and a poll that run together send the row once, not twice")
    void overlappingPassesDoNotDoubleSend() throws Exception {
        CountDownLatch go = new CountDownLatch(1);
        Thread poll = new Thread(() -> {
            try {
                go.await();
            } catch (InterruptedException e) {
                return;
            }
            dispatcher.dispatchQueued();
        });
        poll.start();

        dispatcher.dispatchSoon();
        go.countDown();
        poll.join(5_000);
        awaitSent(1);
        Thread.sleep(300); // long enough for a second, wrongly concurrent, send to have happened

        assertThat(sent).hasSize(1);
    }

    @Test
    @DisplayName("After shutdown, dispatchSoon is a quiet no-op")
    void afterShutdown() {
        dispatcher.stop();

        dispatcher.dispatchSoon();

        assertThat(sent).isEmpty();
    }

    private void awaitSent(int count) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (sent.size() < count && System.nanoTime() < deadline) {
            Thread.sleep(10);
        }
        assertThat(sent).hasSize(count);
    }
}
