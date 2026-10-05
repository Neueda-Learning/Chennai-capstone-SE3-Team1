package com.team1.executor.error;

import com.team1.eventbus.Envelope;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.header.internals.RecordHeader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.stereotype.Service;
import org.apache.kafka.common.header.Header;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

@Service
public class DeadLetterService {
    
    private static final Logger log = LoggerFactory.getLogger(DeadLetterService.class);
    private static final DateTimeFormatter ISO_FORMATTER = 
        DateTimeFormatter.ISO_INSTANT.withZone(ZoneId.of("UTC"));

    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final String deadLetterTopic;

    public DeadLetterService(
            KafkaTemplate<String, Object> kafkaTemplate,
            @Value("${executor.dead-letter-topic:orders.DLT}") String deadLetterTopic) {
        this.kafkaTemplate = kafkaTemplate;
        this.deadLetterTopic = deadLetterTopic;
    }

    public void sendToDLT(String partitionKey, Envelope envelope, ErrorContext errorContext) {
    try {
        log.info("Sending message to DLT: topic={}, key={}, reason={}, attempts={}",
            deadLetterTopic, partitionKey, errorContext.failureReason(), errorContext.attemptCount());

        List<Header> headers = new ArrayList<>();
        headers.add(new RecordHeader("failure-reason", 
            errorContext.failureReason().getBytes(StandardCharsets.UTF_8)));
        headers.add(new RecordHeader("failure-details", 
            errorContext.failureDetails().getBytes(StandardCharsets.UTF_8)));
        headers.add(new RecordHeader("exception-type", 
            errorContext.exceptionType().getBytes(StandardCharsets.UTF_8)));
        headers.add(new RecordHeader("error-category", 
            errorContext.category().name().getBytes(StandardCharsets.UTF_8)));
        headers.add(new RecordHeader("attempt-count", 
            String.valueOf(errorContext.attemptCount()).getBytes(StandardCharsets.UTF_8)));
        headers.add(new RecordHeader("first-failure-time", 
            ISO_FORMATTER.format(errorContext.firstFailureTime()).getBytes(StandardCharsets.UTF_8)));
        headers.add(new RecordHeader("dead-letter-time", 
            ISO_FORMATTER.format(Instant.now()).getBytes(StandardCharsets.UTF_8)));

        ProducerRecord<String, Object> record = new ProducerRecord<>(
            deadLetterTopic,
            null,
            partitionKey,
            envelope,
            headers
        );

        kafkaTemplate.send(record);
        
        log.info("Successfully published to DLT: topic={}, key={}", deadLetterTopic, partitionKey);

    } catch (Exception e) {
        log.error("Failed to publish message to DLT: topic={}, key={}, reason={}",
            deadLetterTopic, partitionKey, errorContext.failureReason(), e);
        throw new RuntimeException("Failed to publish to dead-letter topic", e);
    }
}}