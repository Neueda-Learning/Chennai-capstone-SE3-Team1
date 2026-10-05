package com.team1.trading.api.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.eventbus.Envelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

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
        send(event);
        log.info("Published {} for order {} to topic {} keyed by account {}",
                OrderPlacedEvent.EVENT_TYPE, event.orderUuid(), OrderPlacedEvent.TOPIC, event.accountId());
    }

    public CompletableFuture<SendResult<String, Envelope>> send(OrderPlacedEvent event) {
        Envelope envelope = new Envelope(
                UUID.randomUUID().toString(),
                OrderPlacedEvent.EVENT_TYPE,
                Instant.now().toString(),
                SOURCE,
                SCHEMA_VERSION,
                objectMapper.valueToTree(event));
        return kafkaTemplate.send(OrderPlacedEvent.TOPIC, event.key(), envelope);
    }
}