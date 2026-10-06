package com.team1.trading.api.notifications;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionException;

@Service
public class NotificationDeliveryService implements NotificationDelivery {

    private static final Logger log = LoggerFactory.getLogger(NotificationDeliveryService.class);

    private final NotificationRecorder recorder;

    public NotificationDeliveryService(NotificationRecorder recorder) {
        this.recorder = recorder;
    }

    @Override
    public DeliveryOutcome deliver(AlertNotification alert) {
        if (alert == null) {
            return DeliveryOutcome.REJECTED;
        }
        String deliveryId = alert.deliveryId().toString();
        try {
            if (!recorder.accountExists(alert.accountId())) {
                log.warn("Alert delivery {} refused: unknown account", deliveryId);
                return DeliveryOutcome.REJECTED;
            }
            NotificationRecorder.Recorded recorded = recorder.record(deliveryId, alert.accountId(),
                    NotificationKind.PRICE_ALERT, MessageComposer.alertPayload(alert));
            return recorded.status() == NotificationStatus.PENDING_CHANNEL
                    ? DeliveryOutcome.PENDING_CHANNEL
                    : DeliveryOutcome.QUEUED;
        } catch (DataAccessException | TransactionException e) {
            log.error("Alert delivery {} could not be recorded", deliveryId);
            throw new NotificationDeliveryException("notification could not be recorded", e);
        }
    }
}
