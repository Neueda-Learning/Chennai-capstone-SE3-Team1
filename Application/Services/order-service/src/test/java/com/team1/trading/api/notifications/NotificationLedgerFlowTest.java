package com.team1.trading.api.notifications;

import com.team1.trading.api.notifications.NotificationLedgerMapper.LedgerRow;
import com.team1.trading.api.preferences.ChannelKind;
import com.team1.trading.api.preferences.DatabasePreferenceResolver;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@MybatisTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:notificationledger;DB_CLOSE_DELAY=-1")
@Import({NotificationRecorder.class, NotificationDispatcher.class, DatabasePreferenceResolver.class,
        NotificationLedgerFlowTest.Channels.class})
class NotificationLedgerFlowTest {

    record Sent(ChannelKind kind, String address, String subject, String body) {
    }

    static class RecordingSender implements ChannelSender {
        final List<Sent> sent = new ArrayList<>();
        RuntimeException failure;

        @Override
        public void send(ChannelKind kind, String address, String subject, String body) {
            if (failure != null) {
                throw failure;
            }
            sent.add(new Sent(kind, address, subject, body));
        }
    }

    @TestConfiguration
    static class Channels {
        @Bean
        RecordingSender recordingSender() {
            return new RecordingSender();
        }
    }

    private static final String FILLED = "{\"orderId\":\"o-1\",\"symbol\":\"RELIANCE\",\"side\":\"BUY\","
            + "\"quantity\":\"10\",\"price\":\"2400.00\",\"executedPrice\":\"2401.50\"}";

    @Autowired
    private NotificationRecorder recorder;
    @Autowired
    private NotificationDispatcher dispatcher;
    @Autowired
    private NotificationLedgerMapper mapper;
    @Autowired
    private RecordingSender sender;
    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void reset() {
        sender.sent.clear();
        sender.failure = null;
    }

    private void prefer(long accountId, String channel) {
        jdbc.update("DELETE FROM customer_preferences WHERE account_id = ?", accountId);
        jdbc.update("INSERT INTO customer_preferences (account_id, default_account_id, channel) VALUES (?, ?, ?)",
                accountId, accountId, channel);
    }

    private LedgerRow row(String eventId) {
        return mapper.findByEventId(eventId).orElseThrow();
    }

    @Test
    @DisplayName("A fill with a PUSH preference is recorded QUEUED with the resolved address, then sent")
    void filledEventIsRecordedAndSent() {
        prefer(1L, "PUSH");

        NotificationRecorder.Recorded recorded = recorder.record("ev-1", 1L, NotificationKind.ORDER_FILLED, FILLED);

        assertThat(recorded).isEqualTo(new NotificationRecorder.Recorded(NotificationStatus.QUEUED, true));
        assertThat(row("ev-1").getChannel()).isEqualTo("PUSH");
        assertThat(row("ev-1").getAddress()).isEqualTo("account:1");

        dispatcher.dispatchQueued();

        assertThat(sender.sent).hasSize(1);
        assertThat(sender.sent.get(0).address()).isEqualTo("account:1");
        assertThat(sender.sent.get(0).body()).isEqualTo("Your BUY order for 10 RELIANCE was filled at 2401.50.");
        assertThat(row("ev-1").getStatus()).isEqualTo("SENT");
        assertThat(row("ev-1").getDeliveredAt()).isNotNull();
    }

    @Test
    @DisplayName("A wallet deposit and a withdrawal are recorded under their own kinds and emailed")
    void transfersAreRecordedAndSent() {
        prefer(1L, "PUSH");

        recorder.record("transfer-t-1", 1L, NotificationKind.TRANSFER_IN,
                MessageComposer.transferPayload(true, new java.math.BigDecimal("2500.00"), "INR"));
        recorder.record("transfer-t-2", 1L, NotificationKind.TRANSFER_OUT,
                MessageComposer.transferPayload(false, new java.math.BigDecimal("40.50"), "INR"));
        dispatcher.dispatchQueued();

        assertThat(row("transfer-t-1").getKind()).isEqualTo("TRANSFER_IN");
        assertThat(row("transfer-t-2").getKind()).isEqualTo("TRANSFER_OUT");
        assertThat(sender.sent).extracting(Sent::body).containsExactlyInAnyOrder(
                "2500.00 INR was added to your wallet from your bank account.",
                "40.50 INR was withdrawn from your wallet to your bank account.");
        assertThat(row("transfer-t-1").getStatus()).isEqualTo("SENT");
    }

    @Test
    @DisplayName("A rejection is recorded exactly as a fill is, and says why")
    void rejectionIsRecorded() {
        prefer(1L, "PUSH");

        recorder.record("ev-2", 1L, NotificationKind.ORDER_REJECTED,
                "{\"symbol\":\"TCS\",\"side\":\"SELL\",\"quantity\":\"5\",\"reason\":\"Insufficient holdings\"}");
        dispatcher.dispatchQueued();

        assertThat(row("ev-2").getKind()).isEqualTo("ORDER_REJECTED");
        assertThat(sender.sent.get(0).body()).isEqualTo("Your SELL order for 5 TCS was rejected: Insufficient holdings.");
    }

    @Test
    @DisplayName("Replaying the same event id writes no second row and sends no second message")
    void replayIsIdempotent() {
        prefer(1L, "PUSH");

        NotificationRecorder.Recorded first = recorder.record("ev-3", 1L, NotificationKind.ORDER_FILLED, FILLED);
        NotificationRecorder.Recorded second = recorder.record("ev-3", 1L, NotificationKind.ORDER_FILLED, FILLED);
        dispatcher.dispatchQueued();
        NotificationRecorder.Recorded third = recorder.record("ev-3", 1L, NotificationKind.ORDER_FILLED, FILLED);
        dispatcher.dispatchQueued();

        assertThat(first.created()).isTrue();
        assertThat(second.created()).isFalse();
        assertThat(third).isEqualTo(new NotificationRecorder.Recorded(NotificationStatus.SENT, false));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE event_id = 'ev-3'", Integer.class))
                .isEqualTo(1);
        assertThat(sender.sent).hasSize(1);
    }

    @Test
    @DisplayName("With no stored preference the row is PENDING_CHANNEL with no channel, and nothing is sent")
    void noPreferenceIsHeld() {
        NotificationRecorder.Recorded recorded = recorder.record("ev-4", 2L, NotificationKind.ORDER_FILLED, FILLED);
        dispatcher.dispatchQueued();

        assertThat(recorded.status()).isEqualTo(NotificationStatus.PENDING_CHANNEL);
        assertThat(row("ev-4").getChannel()).isNull();
        assertThat(row("ev-4").getAddress()).isNull();
        assertThat(sender.sent).isEmpty();
    }

    @Test
    @DisplayName("The rescan promotes a held row once a preference exists, and it is then sent")
    void rescanPromotesHeldRow() {
        recorder.record("ev-5", 2L, NotificationKind.ORDER_FILLED, FILLED);
        dispatcher.rescanPending();
        assertThat(row("ev-5").getStatus()).isEqualTo("PENDING_CHANNEL");

        prefer(2L, "PUSH");
        dispatcher.rescanPending();
        assertThat(row("ev-5").getStatus()).isEqualTo("QUEUED");
        assertThat(row("ev-5").getChannel()).isEqualTo("PUSH");

        dispatcher.dispatchQueued();
        assertThat(row("ev-5").getStatus()).isEqualTo("SENT");
        assertThat(sender.sent).hasSize(1);
    }

    @Test
    @DisplayName("The channel is resolved when each event arrives, so a changed preference is honoured")
    void channelIsResolvedPerEvent() {
        prefer(1L, null);
        recorder.record("ev-7a", 1L, NotificationKind.ORDER_FILLED, FILLED);
        prefer(1L, "PUSH");
        recorder.record("ev-7b", 1L, NotificationKind.ORDER_FILLED, FILLED);

        assertThat(row("ev-7a").getChannel()).isNull();
        assertThat(row("ev-7b").getChannel()).isEqualTo("PUSH");
        assertThat(row("ev-7b").getAddress()).isEqualTo("account:1");
    }

    @Test
    @DisplayName("A resolver failure records the row as PENDING_CHANNEL; no fallback channel is chosen")
    void resolverFailureIsHeld() {
        jdbc.update("INSERT INTO customer_preferences (account_id, default_account_id, channel) VALUES (999, 999, 'PUSH')");

        NotificationRecorder.Recorded recorded = recorder.record("ev-8", 999L, NotificationKind.ORDER_FILLED, FILLED);

        assertThat(recorded.status()).isEqualTo(NotificationStatus.PENDING_CHANNEL);
        assertThat(row("ev-8").getChannel()).isNull();
    }

    @Test
    @DisplayName("A channel that refuses the message leaves the row FAILED with a code, and it is not retried")
    void channelRefusalIsFailed() {
        prefer(1L, "PUSH");
        sender.failure = new ChannelDeliveryException("CHANNEL_REFUSED");
        recorder.record("ev-9", 1L, NotificationKind.ORDER_FILLED, FILLED);

        dispatcher.dispatchQueued();
        sender.failure = null;
        dispatcher.dispatchQueued();

        assertThat(row("ev-9").getStatus()).isEqualTo("FAILED");
        assertThat(row("ev-9").getFailureCode()).isEqualTo("CHANNEL_REFUSED");
        assertThat(sender.sent).isEmpty();
    }

    @Test
    @DisplayName("An unexpected channel error is recorded FAILED and does not stop the rest of the batch")
    void unexpectedErrorDoesNotStopTheBatch() {
        prefer(1L, "PUSH");
        recorder.record("ev-10a", 1L, NotificationKind.ORDER_FILLED, FILLED);
        sender.failure = new IllegalStateException("boom");
        dispatcher.dispatchQueued();
        sender.failure = null;
        recorder.record("ev-10b", 1L, NotificationKind.ORDER_FILLED, FILLED);
        dispatcher.dispatchQueued();

        assertThat(row("ev-10a").getStatus()).isEqualTo("FAILED");
        assertThat(row("ev-10a").getFailureCode()).isEqualTo("CHANNEL_ERROR");
        assertThat(row("ev-10b").getStatus()).isEqualTo("SENT");
    }

    @Test
    @DisplayName("The per-account cap keeps only the newest rows")
    void capKeepsNewestRows() {
        prefer(1L, "PUSH");
        for (int i = 0; i < 5; i++) {
            recorder.record("cap-" + i, 1L, NotificationKind.ORDER_FILLED, FILLED);
        }

        int removed = mapper.pruneBeyond(1L, 3);

        assertThat(removed).isEqualTo(2);
        assertThat(mapper.countForAccount(1L)).isEqualTo(3);
        assertThat(mapper.findByEventId("cap-4")).isPresent();
        assertThat(mapper.findByEventId("cap-0")).isEmpty();
    }

    @Test
    @DisplayName("History is the account's own rows, newest first, honours limit and the before cursor, and omits the address")
    void historyIsPagedAndOwnOnly() throws Exception {
        prefer(1L, "PUSH");
        prefer(2L, "PUSH");
        for (int i = 0; i < 4; i++) {
            recorder.record("h-" + i, 1L, NotificationKind.ORDER_FILLED, FILLED);
            Thread.sleep(5);
        }
        recorder.record("other", 2L, NotificationKind.ORDER_FILLED, FILLED);

        NotificationHistoryService history = new NotificationHistoryService(mapper);
        List<NotificationHistoryEntry> firstPage = history.history(1L, 2, null);
        List<NotificationHistoryEntry> secondPage = history.history(1L, 2, firstPage.get(1).createdAt());

        assertThat(firstPage).hasSize(2);
        assertThat(secondPage).hasSize(2);
        assertThat(firstPage.get(0).createdAt()).isAfter(firstPage.get(1).createdAt());
        assertThat(secondPage.get(0).createdAt()).isBefore(firstPage.get(1).createdAt());
        assertThat(history.history(1L, 0, null)).hasSize(1);
        assertThat(history.history(1L, 5000, null)).hasSize(4);
        assertThat(history.history(1L, null, null)).hasSize(4);
        assertThat(firstPage.get(0).message()).isEqualTo("Your BUY order for 10 RELIANCE was filled at 2401.50.");
        assertThat(firstPage.get(0).channel()).isEqualTo(ChannelKind.PUSH);
        assertThat(firstPage.get(0).toString()).doesNotContain("example.com");
    }
}
