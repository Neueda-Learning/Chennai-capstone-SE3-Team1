package com.team1.trading.api.watchlists;

import com.team1.trading.api.watchlists.PriceAlertMapper.AlertRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;

@Component
public class AlertDeliverySweeper {

    static final Duration MIN_AGE = Duration.ofSeconds(30);
    static final int BATCH = 100;

    private static final Logger log = LoggerFactory.getLogger(AlertDeliverySweeper.class);

    private final PriceAlertMapper alerts;
    private final AlertEvaluator evaluator;

    public AlertDeliverySweeper(PriceAlertMapper alerts, AlertEvaluator evaluator) {
        this.alerts = alerts;
        this.evaluator = evaluator;
    }

    @Scheduled(fixedDelayString = "${watchlists.sweep.interval-ms:60000}")
    public void sweep() {
        sweep(MIN_AGE);
    }

    /**
     * Hands over alerts that fired at least {@code minAge} ago and never reached Notifications because the
     * process stopped between the state change and the hand-over. The delivery id is derived from the alert
     * and its fire time, so an alert that was in fact handed over is a no-op replay. Alerts already marked
     * DELIVERY_FAILED are not retried.
     */
    int sweep(Duration minAge) {
        try {
            List<AlertRow> pending = alerts.findUndelivered(WatchlistSupport.now().minus(minAge), BATCH);
            for (AlertRow row : pending) {
                evaluator.handOver(row);
            }
            return pending.size();
        } catch (DataAccessException e) {
            log.error("Could not sweep undelivered alerts; will try again", e);
            return 0;
        }
    }
}
