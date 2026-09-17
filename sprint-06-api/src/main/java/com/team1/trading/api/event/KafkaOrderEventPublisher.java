package com.team1.trading.api.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.eventbus.Envelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Instant;
import java.util.UUID;

/**
 * Publishes an {@link OrderPlacedEvent} to the {@code orders} Kafka topic, wrapped in the
 * shared five-field {@link Envelope} so the message matches {@code contracts/kafka-topics.md}.
 *
 * <p>The listener runs {@code AFTER_COMMIT}: it fires only once the transaction that wrote the
 * order row has committed. A committed-but-never-published order can be replayed from the order
 * table (the recoverable failure), whereas an event for an order that rolled back would be
 * impossible to undo, so the event is never produced inside the transaction.
 *
 * <p>The producer is configured with {@code acks=all} and {@code enable.idempotence=true}, which
 * removes the duplicates a producer retry causes. It does not remove the duplicates an application
 * retry causes, so the executor still has to be idempotent itself.
 */
@Component
public class KafkaOrderEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(KafkaOrderEventPublisher.class);

    private static final String SOURCE = "trade-api";
    private static final int SCHEMA_VERSION = 1;

    private final KafkaTemplate<String, Envelope> kafkaTemplate;
    private final ObjectMapper objectMapper;

    public KafkaOrderEventPublisher(KafkaTemplate<String, Envelope> kafkaTemplate,
                                    ObjectMapper objectMapper) {
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void publish(OrderPlacedEvent event) {
        Envelope envelope = new Envelope(
                UUID.randomUUID().toString(),
                OrderPlacedEvent.EVENT_TYPE,
                Instant.now().toString(),
                SOURCE,
                SCHEMA_VERSION,
                objectMapper.valueToTree(event));
        kafkaTemplate.send(OrderPlacedEvent.TOPIC, event.key(), envelope);
        log.info("Published {} for order {} to topic {} keyed by account {}",
                OrderPlacedEvent.EVENT_TYPE, event.orderUuid(), OrderPlacedEvent.TOPIC, event.accountId());
    }
}