package com.team1.trading.api.watchlists;

import com.team1.trading.api.notifications.AlertNotification;
import com.team1.trading.api.notifications.DeliveryOutcome;
import com.team1.trading.api.notifications.Direction;
import com.team1.trading.api.notifications.NotificationDelivery;
import com.team1.trading.api.notifications.NotificationDeliveryException;
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

import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@MybatisTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:alertevaluation;DB_CLOSE_DELAY=-1")
@Import({AlertService.class, AlertEvaluator.class, AlertDeliverySweeper.class,
        AlertEvaluationFlowTest.Seam.class})
class AlertEvaluationFlowTest {

    static class RecordingDelivery implements NotificationDelivery {
        final List<AlertNotification> delivered = new ArrayList<>();
        DeliveryOutcome outcome = DeliveryOutcome.QUEUED;
        RuntimeException failure;

        @Override
        public DeliveryOutcome deliver(AlertNotification alert) {
            delivered.add(alert);
            if (failure != null) {
                throw failure;
            }
            return outcome;
        }
    }

    @TestConfiguration
    static class Seam {
        @Bean
        RecordingDelivery recordingDelivery() {
            return new RecordingDelivery();
        }
    }

    @Autowired
    private AlertService alerts;
    @Autowired
    private AlertEvaluator evaluator;
    @Autowired
    private AlertDeliverySweeper sweeper;
    @Autowired
    private RecordingDelivery delivery;
    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void reset() {
        delivery.delivered.clear();
        delivery.outcome = DeliveryOutcome.QUEUED;
        delivery.failure = null;
    }

    private AlertResponse alert(long account, String symbol, String threshold, Direction direction) {
        return alerts.create(account, new CreateAlertRequest(symbol, new BigDecimal(threshold), direction));
    }

    private AlertResponse reload(long account, String id) {
        return alerts.list(account).stream().filter(a -> a.id().equals(id)).findFirst().orElseThrow();
    }

    @Test
    @DisplayName("A quote that crosses an ABOVE threshold fires the alert and hands it to Notifications")
    void crossingQuoteFires() {
        AlertResponse alert = alert(1L, "TCS", "3500", Direction.ABOVE);

        int fired = evaluator.evaluate("TCS", new BigDecimal("3501.25"));

        assertThat(fired).isEqualTo(1);
        AlertResponse after = reload(1L, alert.id());
        assertThat(after.state()).isEqualTo(AlertState.FIRED);
        assertThat(after.firedPrice()).isEqualByComparingTo("3501.25");
        assertThat(after.firedAt()).isNotNull();
        assertThat(after.deliveryState()).isEqualTo(AlertDeliveryState.QUEUED);

        assertThat(delivery.delivered).hasSize(1);
        AlertNotification sent = delivery.delivered.get(0);
        assertThat(sent.accountId()).isEqualTo(1L);
        assertThat(sent.symbol()).isEqualTo("TCS");
        assertThat(sent.direction()).isEqualTo(Direction.ABOVE);
        assertThat(sent.threshold()).isEqualByComparingTo("3500");
        assertThat(sent.observedPrice()).isEqualByComparingTo("3501.25");
    }

    @Test
    @DisplayName("A quote short of the threshold does not fire it, for either direction")
    void shortOfThresholdDoesNotFire() {
        AlertResponse above = alert(1L, "TCS", "3500", Direction.ABOVE);
        AlertResponse below = alert(1L, "TCS", "3000", Direction.BELOW);

        assertThat(evaluator.evaluate("TCS", new BigDecimal("3499.99"))).isZero();
        assertThat(evaluator.evaluate("TCS", new BigDecimal("3000.01"))).isZero();

        assertThat(reload(1L, above.id()).state()).isEqualTo(AlertState.ARMED);
        assertThat(reload(1L, below.id()).state()).isEqualTo(AlertState.ARMED);
        assertThat(delivery.delivered).isEmpty();
    }

    @Test
    @DisplayName("Crossed means reaching the threshold: equal fires, and BELOW fires at or under it")
    void equalFiresAndBelowWorks() {
        AlertResponse above = alert(1L, "TCS", "3500", Direction.ABOVE);
        AlertResponse below = alert(1L, "INFY", "1400", Direction.BELOW);

        assertThat(evaluator.evaluate("TCS", new BigDecimal("3500.00"))).isEqualTo(1);
        assertThat(evaluator.evaluate("INFY", new BigDecimal("1399.00"))).isEqualTo(1);

        assertThat(reload(1L, above.id()).state()).isEqualTo(AlertState.FIRED);
        assertThat(reload(1L, below.id()).state()).isEqualTo(AlertState.FIRED);
    }

    @Test
    @DisplayName("An alert fires once: later quotes past the threshold do not fire it again until it is re-armed")
    void firesOnceThenWaitsForReset() {
        AlertResponse alert = alert(1L, "TCS", "3500", Direction.ABOVE);

        evaluator.evaluate("TCS", new BigDecimal("3501"));
        assertThat(evaluator.evaluate("TCS", new BigDecimal("3502"))).isZero();
        assertThat(evaluator.evaluate("TCS", new BigDecimal("3600"))).isZero();
        assertThat(delivery.delivered).hasSize(1);

        alerts.update(1L, alert.id(), new UpdateAlertRequest(SettableAlertState.ARMED));
        assertThat(evaluator.evaluate("TCS", new BigDecimal("3601"))).isEqualTo(1);

        assertThat(delivery.delivered).hasSize(2);
        assertThat(delivery.delivered.get(1).deliveryId()).isNotEqualTo(delivery.delivered.get(0).deliveryId());
    }

    @Test
    @DisplayName("Only alerts for the quoted symbol are evaluated, and a disabled alert never fires")
    void onlyTheQuotedSymbolAndOnlyArmed() {
        AlertResponse other = alert(1L, "INFY", "1", Direction.ABOVE);
        AlertResponse disabled = alert(1L, "TCS", "1", Direction.ABOVE);
        alerts.update(1L, disabled.id(), new UpdateAlertRequest(SettableAlertState.DISABLED));

        assertThat(evaluator.evaluate("TCS", new BigDecimal("3500"))).isZero();

        assertThat(reload(1L, other.id()).state()).isEqualTo(AlertState.ARMED);
        assertThat(reload(1L, disabled.id()).state()).isEqualTo(AlertState.DISABLED);
        assertThat(delivery.delivered).isEmpty();
    }

    @Test
    @DisplayName("One quote fires every account's crossed alert, each delivered to its own account")
    void alertsOfSeveralAccounts() {
        alert(1L, "TCS", "3400", Direction.ABOVE);
        alert(2L, "TCS", "3450", Direction.ABOVE);
        alert(3L, "TCS", "3600", Direction.ABOVE);

        assertThat(evaluator.evaluate("TCS", new BigDecimal("3500"))).isEqualTo(2);

        assertThat(delivery.delivered).extracting(AlertNotification::accountId).containsExactlyInAnyOrder(1L, 2L);
    }

    @Test
    @DisplayName("Notifications answering PENDING_CHANNEL or REJECTED is recorded; the alert stays FIRED")
    void outcomesAreRecorded() {
        AlertResponse pending = alert(1L, "TCS", "1", Direction.ABOVE);
        delivery.outcome = DeliveryOutcome.PENDING_CHANNEL;
        evaluator.evaluate("TCS", new BigDecimal("2"));
        assertThat(reload(1L, pending.id()).state()).isEqualTo(AlertState.FIRED);
        assertThat(reload(1L, pending.id()).deliveryState()).isEqualTo(AlertDeliveryState.PENDING_CHANNEL);

        AlertResponse rejected = alert(1L, "INFY", "1", Direction.ABOVE);
        delivery.outcome = DeliveryOutcome.REJECTED;
        evaluator.evaluate("INFY", new BigDecimal("2"));
        assertThat(reload(1L, rejected.id()).state()).isEqualTo(AlertState.FIRED);
        assertThat(reload(1L, rejected.id()).deliveryState()).isEqualTo(AlertDeliveryState.REJECTED);
    }

    @Test
    @DisplayName("When the hand-over raises, the alert is FIRED with DELIVERY_FAILED, is not retried, and the quote is still handled")
    void failedHandOverIsRecordedAndNotRetried() {
        AlertResponse alert = alert(1L, "TCS", "1", Direction.ABOVE);
        delivery.failure = new NotificationDeliveryException("notification could not be recorded", new RuntimeException());

        int fired = evaluator.evaluate("TCS", new BigDecimal("2"));

        assertThat(fired).isEqualTo(1);
        assertThat(reload(1L, alert.id()).state()).isEqualTo(AlertState.FIRED);
        assertThat(reload(1L, alert.id()).deliveryState()).isEqualTo(AlertDeliveryState.DELIVERY_FAILED);

        jdbc.update("UPDATE price_alerts SET fired_at = TIMESTAMP '2026-10-05 08:00:00'");
        delivery.delivered.clear();
        assertThat(sweeper.sweep(Duration.ofSeconds(30))).isZero();
        assertThat(delivery.delivered).isEmpty();
    }

    @Test
    @DisplayName("A FIRED alert that was never handed over (a crash between the two steps) is handed over by the sweep")
    void sweepRecoversAnUndeliveredAlert() {
        AlertResponse alert = alert(1L, "TCS", "3500", Direction.ABOVE);
        jdbc.update("UPDATE price_alerts SET state = 'FIRED', fired_at = TIMESTAMP '2026-10-05 08:00:00', "
                + "fired_price = 3510 WHERE alert_id = CAST(? AS UUID)", alert.id());

        assertThat(sweeper.sweep(Duration.ofSeconds(30))).isEqualTo(1);

        assertThat(delivery.delivered).hasSize(1);
        assertThat(delivery.delivered.get(0).observedPrice()).isEqualByComparingTo("3510");
        assertThat(reload(1L, alert.id()).deliveryState()).isEqualTo(AlertDeliveryState.QUEUED);
        assertThat(sweeper.sweep(Duration.ofSeconds(30))).isZero();
    }

    @Test
    @DisplayName("The sweep leaves alert fired moments ago alone, so it cannot race the evaluator")
    void sweepSkipsRecentlyFiredAlerts() {
        AlertResponse alert = alert(1L, "TCS", "3500", Direction.ABOVE);
        jdbc.update("UPDATE price_alerts SET state = 'FIRED', fired_at = CURRENT_TIMESTAMP, fired_price = 3510 "
                + "WHERE alert_id = CAST(? AS UUID)", alert.id());

        assertThat(sweeper.sweep(Duration.ofMinutes(5))).isZero();
        assertThat(delivery.delivered).isEmpty();
    }

    @Test
    @DisplayName("The delivery id is stable for one firing and differs between firings")
    void deliveryIdIsDeterministic() {
        AlertResponse alert = alert(1L, "TCS", "3500", Direction.ABOVE);
        jdbc.update("UPDATE price_alerts SET state = 'FIRED', fired_at = TIMESTAMP '2026-10-05 08:00:00', "
                + "fired_price = 3510 WHERE alert_id = CAST(? AS UUID)", alert.id());

        sweeper.sweep(Duration.ofSeconds(30));
        jdbc.update("UPDATE price_alerts SET delivery_state = NULL");
        sweeper.sweep(Duration.ofSeconds(30));
        assertThat(delivery.delivered).hasSize(2);
        assertThat(delivery.delivered.get(1).deliveryId()).isEqualTo(delivery.delivered.get(0).deliveryId());

        jdbc.update("UPDATE price_alerts SET delivery_state = NULL, fired_at = TIMESTAMP '2026-10-05 09:00:00'");
        sweeper.sweep(Duration.ofSeconds(30));
        assertThat(delivery.delivered.get(2).deliveryId()).isNotEqualTo(delivery.delivered.get(0).deliveryId());
    }

    @Test
    @DisplayName("The guarded update lets only one writer fire an alert")
    void guardedFireUpdate() {
        AlertResponse alert = alert(1L, "TCS", "3500", Direction.ABOVE);
        Map<String, Object> before = jdbc.queryForMap("SELECT state FROM price_alerts");
        assertThat(before.get("STATE")).isEqualTo("ARMED");

        assertThat(evaluator.evaluate("TCS", new BigDecimal("3600"))).isEqualTo(1);
        assertThat(evaluator.evaluate("TCS", new BigDecimal("3600"))).isZero();
        assertThat(delivery.delivered).hasSize(1);
        assertThat(reload(1L, alert.id()).state()).isEqualTo(AlertState.FIRED);
    }
}
