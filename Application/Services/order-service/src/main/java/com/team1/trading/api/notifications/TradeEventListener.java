package com.team1.trading.api.notifications;

import com.fasterxml.jackson.databind.JsonNode;
import com.team1.eventbus.Envelope;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;
import org.springframework.transaction.TransactionException;

import java.time.Duration;

@Component
public class TradeEventListener {

    public static final String GROUP_ID = "notification-service";
    public static final String TOPIC = "trade-events";

    static final int EVENT_ID_LIMIT = 64;
    static final Duration RETRY_AFTER = Duration.ofSeconds(5);

    private static final Logger log = LoggerFactory.getLogger(TradeEventListener.class);

    private final NotificationRecorder recorder;

    public TradeEventListener(NotificationRecorder recorder) {
        this.recorder = recorder;
    }

    @KafkaListener(topics = TOPIC, groupId = GROUP_ID)
    public void onTradeEvent(ConsumerRecord<String, Envelope> record, Acknowledgment ack) {
        Envelope envelope = record.value();
        NotificationKind kind = envelope == null ? null : kindFor(envelope.eventType());
        if (kind == null) {
            ack.acknowledge();
            return;
        }

        String eventId = envelope.eventId();
        Long accountId = accountId(envelope.payload());
        if (eventId == null || eventId.isBlank() || eventId.length() > EVENT_ID_LIMIT || accountId == null) {
            log.warn("Ignoring a {} event with no usable event id or account at {}-{}@{}",
                    kind, record.topic(), record.partition(), record.offset());
            ack.acknowledge();
            return;
        }

        try {
            if (!recorder.accountExists(accountId)) {
                log.warn("Ignoring event {}: its account is not known", eventId);
            } else {
                recorder.record(eventId, accountId, kind, MessageComposer.tradePayload(envelope.payload()));
            }
            ack.acknowledge();
        } catch (DataAccessException | TransactionException e) {
            log.error("Could not record event {}; it will be redelivered", eventId, e);
            ack.nack(RETRY_AFTER);
        } catch (RuntimeException e) {
            log.error("Could not process event {}; skipping it", eventId, e);
            ack.acknowledge();
        }
    }

    private static NotificationKind kindFor(String eventType) {
        if (eventType == null) {
            return null;
        }
        return switch (eventType) {
            case "ORDER_FILLED" -> NotificationKind.ORDER_FILLED;
            case "ORDER_REJECTED" -> NotificationKind.ORDER_REJECTED;
            case "ORDER_CANCELLED" -> NotificationKind.ORDER_CANCELLED;
            default -> null;
        };
    }

    private static Long accountId(JsonNode payload) {
        JsonNode node = payload == null ? null : payload.get("accountId");
        if (node == null || !node.canConvertToLong() || node.asLong() <= 0) {
            return null;
        }
        return node.asLong();
    }
}
