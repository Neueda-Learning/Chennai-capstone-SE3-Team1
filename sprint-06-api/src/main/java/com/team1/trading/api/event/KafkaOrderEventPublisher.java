package com.team1.trading.api.event;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Publishes an {@link OrderPlacedEvent} to the {@code orders} Kafka topic.
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

    private final KafkaTemplate<String, OrderPlacedEvent> kafkaTemplate;

    public KafkaOrderEventPublisher(KafkaTemplate<String, OrderPlacedEvent> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void publish(OrderPlacedEvent event) {
        kafkaTemplate.send(OrderPlacedEvent.TOPIC, event.key(), event);
        log.info("Published {} for order {} to topic {} keyed by account {}",
                OrderPlacedEvent.EVENT_TYPE, event.orderUuid(), OrderPlacedEvent.TOPIC, event.accountId());
    }
}