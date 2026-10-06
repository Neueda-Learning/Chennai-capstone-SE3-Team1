package com.team1.trading.api.watchlists;

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

import java.math.BigDecimal;
import java.time.Duration;
import java.util.Locale;

@Component
public class MarketDataAlertListener {

    public static final String GROUP_ID = "watchlist-service";
    public static final String TOPIC = "market-data";

    static final Duration RETRY_AFTER = Duration.ofSeconds(5);

    private static final Logger log = LoggerFactory.getLogger(MarketDataAlertListener.class);

    private final AlertEvaluator evaluator;

    public MarketDataAlertListener(AlertEvaluator evaluator) {
        this.evaluator = evaluator;
    }

    @KafkaListener(topics = TOPIC, groupId = GROUP_ID)
    public void onQuote(ConsumerRecord<String, Envelope> record, Acknowledgment ack) {
        Envelope envelope = record.value();
        if (envelope == null || !"QUOTE".equals(envelope.eventType())) {
            ack.acknowledge();
            return;
        }

        JsonNode payload = envelope.payload();
        String symbol = symbol(payload);
        BigDecimal price = price(payload);
        if (symbol == null || price == null) {
            log.warn("Ignoring a quote with no usable symbol or price at {}-{}@{}",
                    record.topic(), record.partition(), record.offset());
            ack.acknowledge();
            return;
        }
        if (isStale(payload)) {
            ack.acknowledge();
            return;
        }

        try {
            int fired = evaluator.evaluate(symbol, price);
            if (fired > 0) {
                log.info("{} price alert(s) fired for {}", fired, symbol);
            }
            ack.acknowledge();
        } catch (DataAccessException | TransactionException e) {
            log.error("Could not evaluate the quote for {}; it will be redelivered", symbol, e);
            ack.nack(RETRY_AFTER);
        } catch (RuntimeException e) {
            log.error("Could not evaluate the quote for {}; skipping it", symbol, e);
            ack.acknowledge();
        }
    }

    private static String symbol(JsonNode payload) {
        JsonNode node = payload == null ? null : payload.get("symbol");
        if (node == null || node.isNull()) {
            return null;
        }
        String value = node.asText().trim().toUpperCase(Locale.ROOT);
        return value.isEmpty() || value.length() > 20 ? null : value;
    }

    private static BigDecimal price(JsonNode payload) {
        JsonNode node = payload == null ? null : payload.get("price");
        if (node == null || !node.isNumber()) {
            return null;
        }
        BigDecimal value = node.decimalValue();
        return value.signum() > 0 && value.precision() - value.scale() <= 14 ? value : null;
    }

    private static boolean isStale(JsonNode payload) {
        JsonNode node = payload.get("stale");
        return node != null && node.asBoolean(false);
    }
}
