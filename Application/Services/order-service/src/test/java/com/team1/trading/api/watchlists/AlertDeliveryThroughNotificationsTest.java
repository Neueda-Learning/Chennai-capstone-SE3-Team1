package com.team1.trading.api.watchlists;

import com.team1.trading.api.notifications.Direction;
import com.team1.trading.api.notifications.NotificationDeliveryService;
import com.team1.trading.api.notifications.NotificationLedgerMapper;
import com.team1.trading.api.notifications.NotificationLedgerMapper.LedgerRow;
import com.team1.trading.api.notifications.NotificationRecorder;
import com.team1.trading.api.preferences.DatabasePreferenceResolver;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.math.BigDecimal;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

@MybatisTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:alertthroughnotifications;DB_CLOSE_DELAY=-1")
@Import({AlertService.class, AlertEvaluator.class, AlertDeliverySweeper.class, NotificationDeliveryService.class,
        NotificationRecorder.class, DatabasePreferenceResolver.class})
class AlertDeliveryThroughNotificationsTest {

    @Autowired
    private AlertService alerts;
    @Autowired
    private AlertEvaluator evaluator;
    @Autowired
    private AlertDeliverySweeper sweeper;
    @Autowired
    private NotificationLedgerMapper ledger;
    @Autowired
    private JdbcTemplate jdbc;

    private void prefer(long accountId, String channel) {
        jdbc.update("DELETE FROM customer_preferences WHERE account_id = ?", accountId);
        jdbc.update("INSERT INTO customer_preferences (account_id, default_account_id, channel) VALUES (?, ?, ?)",
                accountId, accountId, channel);
    }

    private String eventId(String alertId) {
        return jdbc.queryForObject("SELECT event_id FROM notifications WHERE kind = 'PRICE_ALERT'", String.class);
    }

    @Test
    @DisplayName("A crossed alert becomes a PRICE_ALERT row in the customer's notification ledger on their channel")
    void firedAlertIsInTheLedger() {
        prefer(1L, "PUSH");
        AlertResponse alert = alerts.create(1L, new CreateAlertRequest("TCS", new BigDecimal("3500"), Direction.ABOVE));

        evaluator.evaluate("TCS", new BigDecimal("3501.25"));

        LedgerRow row = ledger.findByEventId(eventId(alert.id())).orElseThrow();
        assertThat(row.getAccountId()).isEqualTo(1L);
        assertThat(row.getKind()).isEqualTo("PRICE_ALERT");
        assertThat(row.getChannel()).isEqualTo("PUSH");
        assertThat(row.getStatus()).isEqualTo("QUEUED");
        assertThat(row.getPayload()).contains("TCS").contains("3501.25");
        assertThat(alerts.list(1L).get(0).deliveryState()).isEqualTo(AlertDeliveryState.QUEUED);
    }

    @Test
    @DisplayName("With no stored preference the alert is held PENDING_CHANNEL, not lost and not logged away")
    void noPreferenceIsHeld() {
        jdbc.update("DELETE FROM customer_preferences WHERE account_id = 2");
        AlertResponse alert = alerts.create(2L, new CreateAlertRequest("INFY", new BigDecimal("1400"), Direction.BELOW));

        evaluator.evaluate("INFY", new BigDecimal("1390"));

        LedgerRow row = ledger.findByEventId(eventId(alert.id())).orElseThrow();
        assertThat(row.getStatus()).isEqualTo("PENDING_CHANNEL");
        assertThat(alerts.list(2L).get(0).deliveryState()).isEqualTo(AlertDeliveryState.PENDING_CHANNEL);
    }

    @Test
    @DisplayName("A second hand-over of the same firing writes no second ledger row")
    void replayIsIdempotent() {
        prefer(1L, "PUSH");
        AlertResponse alert = alerts.create(1L, new CreateAlertRequest("TCS", new BigDecimal("3500"), Direction.ABOVE));
        evaluator.evaluate("TCS", new BigDecimal("3600"));

        jdbc.update("UPDATE price_alerts SET delivery_state = NULL, fired_at = fired_at - INTERVAL '1' HOUR");
        jdbc.update("UPDATE notifications SET event_id = event_id");
        String first = eventId(alert.id());
        jdbc.update("UPDATE price_alerts SET fired_at = fired_at + INTERVAL '1' HOUR");
        sweeper.sweep(Duration.ofSeconds(-1));
        sweeper.sweep(Duration.ofSeconds(-1));

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE kind = 'PRICE_ALERT'",
                Integer.class)).isEqualTo(1);
        assertThat(eventId(alert.id())).isEqualTo(first);
    }
}
