package com.team1.trading.api.watchlists;

import com.team1.trading.api.notifications.AlertNotification;
import com.team1.trading.api.notifications.Direction;
import com.team1.trading.api.notifications.NotificationDelivery;
import com.team1.trading.api.watchlists.PriceAlertMapper.AlertRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.UUID;

@Component
public class AlertEvaluator {

    private static final Logger log = LoggerFactory.getLogger(AlertEvaluator.class);

    private final PriceAlertMapper alerts;
    private final NotificationDelivery delivery;

    public AlertEvaluator(PriceAlertMapper alerts, NotificationDelivery delivery) {
        this.alerts = alerts;
        this.delivery = delivery;
    }

    /**
     * Fires every armed alert for {@code symbol} that this quote has reached, at most once each, and hands
     * each to Notifications. ABOVE fires at or above the threshold, BELOW at or below it. Returns the number
     * fired. A database failure propagates; a failure of the hand-over is recorded on the alert.
     */
    public int evaluate(String symbol, BigDecimal price) {
        BigDecimal quote = price.setScale(4, RoundingMode.HALF_UP);
        int fired = 0;
        for (AlertRow row : alerts.findCrossedArmed(symbol, quote)) {
            LocalDateTime firedAt = WatchlistSupport.now();
            if (alerts.fire(row.getId(), firedAt, quote) == 1) {
                fired++;
                row.setState(AlertState.FIRED.name());
                row.setFiredAt(firedAt);
                row.setFiredPrice(quote);
                handOver(row);
            }
        }
        return fired;
    }

    void handOver(AlertRow row) {
        AlertNotification notification = new AlertNotification(
                deliveryId(row), row.getAccountId(), row.getSymbol(), row.getThreshold(),
                Direction.valueOf(row.getDirection()), row.getFiredPrice(),
                WatchlistSupport.utc(row.getFiredAt()));

        AlertDeliveryState state;
        try {
            state = AlertDeliveryState.of(delivery.deliver(notification));
        } catch (RuntimeException e) {
            log.error("Could not hand alert {} to Notifications; recording DELIVERY_FAILED", row.getId(), e);
            state = AlertDeliveryState.DELIVERY_FAILED;
        }
        alerts.setDeliveryState(row.getId(), state.name(), WatchlistSupport.now());
    }

    static UUID deliveryId(AlertRow row) {
        return UUID.nameUUIDFromBytes((row.getId() + "|" + row.getFiredAt()).getBytes(StandardCharsets.UTF_8));
    }
}
