package com.team1.trading.api.event;

import com.fasterxml.jackson.databind.JsonNode;
import com.team1.eventbus.Envelope;
import com.team1.trading.api.mapper.PositionMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

/**
 * Keeps {@code portfolio_holding.overall_gains} current from the {@code market-data} stream.
 *
 * <p>Unrealised gain needs a market price, and the holding row has only what the stock cost.
 * The poller inside the Trade Executor already publishes a quote per symbol on every cycle,
 * so the price is on the bus; this marks holdings to it as the quotes arrive. The refresh
 * rate is therefore the poll interval - a minute by default - which is the resolution this
 * figure is wanted at.
 *
 * <p>Ordering is safe without any work here. {@code market-data} is keyed by symbol, so all
 * quotes for one instrument land on one partition and arrive in the order they were
 * published; an older price cannot overwrite a newer one.
 */
@Component
public class MarketDataListener {

    private static final Logger log = LoggerFactory.getLogger(MarketDataListener.class);
    private static final String QUOTE = "QUOTE";

    private final PositionMapper positionMapper;

    public MarketDataListener(PositionMapper positionMapper) {
        this.positionMapper = positionMapper;
    }

    @KafkaListener(topics = "market-data", groupId = "portfolio-service")
    public void onQuote(ConsumerRecord<String, Envelope> record, Acknowledgment ack) {
        try {
            Envelope envelope = record.value();
            if (envelope == null || !QUOTE.equals(envelope.eventType())) {
                return;                     // not ours; the finally block still commits it
            }

            JsonNode payload = envelope.payload();
            String symbol = text(payload, "symbol");
            BigDecimal price = decimal(payload, "price");
            if (symbol == null || price == null || price.signum() <= 0) {
                log.warn("Ignoring a quote with no usable symbol or price: {}", payload);
                return;
            }

            int holdings = positionMapper.markToMarket(symbol, price);
            int positions = positionMapper.markPositionsToMarket(symbol, price);
            if (holdings + positions > 0) {
                log.debug("Marked {} holding(s) and {} position(s) of {} to {}",
                        holdings, positions, symbol, price);
            }
        } catch (Exception e) {
            // A quote is worth less than the stream. Failing here would stop the partition
            // and block every later quote for this symbol, so the price is dropped and the
            // next cycle - a minute away - supersedes it anyway.
            log.error("Could not apply a quote from {}-{}@{}; skipping it",
                    record.topic(), record.partition(), record.offset(), e);
        } finally {
            ack.acknowledge();
        }
    }

    private static String text(JsonNode payload, String field) {
        JsonNode node = payload == null ? null : payload.get(field);
        if (node == null || node.isNull()) {
            return null;
        }
        String value = node.asText().trim();
        return value.isEmpty() ? null : value;
    }

    private static BigDecimal decimal(JsonNode payload, String field) {
        JsonNode node = payload == null ? null : payload.get(field);
        return node == null || node.isNull() || !node.isNumber() ? null : node.decimalValue();
    }
}
