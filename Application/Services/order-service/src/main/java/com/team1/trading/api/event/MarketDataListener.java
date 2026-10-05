package com.team1.trading.api.event;

import com.fasterxml.jackson.databind.JsonNode;
import com.team1.eventbus.Envelope;
import com.team1.trading.api.mapper.MarketQuoteMapper;
import com.team1.trading.api.mapper.MarketQuoteMapper.QuoteInsert;
import com.team1.trading.api.mapper.PositionMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;

@Component
public class MarketDataListener {

    private static final Logger log = LoggerFactory.getLogger(MarketDataListener.class);
    private static final String QUOTE = "QUOTE";

    static final int RETENTION_DAYS = 14;

    private final PositionMapper positionMapper;
    private final MarketQuoteMapper marketQuoteMapper;

    public MarketDataListener(PositionMapper positionMapper, MarketQuoteMapper marketQuoteMapper) {
        this.positionMapper = positionMapper;
        this.marketQuoteMapper = marketQuoteMapper;
    }

    @KafkaListener(topics = "market-data", groupId = "portfolio-service")
    public void onQuote(ConsumerRecord<String, Envelope> record, Acknowledgment ack) {
        try {
            Envelope envelope = record.value();
            if (envelope == null || !QUOTE.equals(envelope.eventType())) {
                return;
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

            marketQuoteMapper.insert(toInsert(symbol, price, payload));
            marketQuoteMapper.deleteOlderThan(symbol, RETENTION_DAYS);
        } catch (Exception e) {
            log.error("Could not apply a quote from {}-{}@{}; skipping it",
                    record.topic(), record.partition(), record.offset(), e);
        } finally {
            ack.acknowledge();
        }
    }

    private static QuoteInsert toInsert(String symbol, BigDecimal price, JsonNode payload) {
        QuoteInsert insert = new QuoteInsert();
        insert.setSymbol(symbol);
        insert.setPrice(price);
        insert.setBid(decimal(payload, "bid"));
        insert.setAsk(decimal(payload, "ask"));
        insert.setCurrency(text(payload, "currency"));
        insert.setChange(decimal(payload, "change"));
        insert.setChangePercent(decimal(payload, "changePercent"));
        insert.setPreviousClose(decimal(payload, "previousClose"));
        insert.setMarketState(text(payload, "marketState"));
        JsonNode stale = payload.get("stale");
        insert.setStale(stale != null && stale.asBoolean(false));
        insert.setQuoteAsOf(instant(payload, "quoteAsOf"));
        return insert;
    }

    private static OffsetDateTime instant(JsonNode payload, String field) {
        String value = text(payload, field);
        if (value == null) {
            return null;
        }
        try {
            return OffsetDateTime.parse(value);
        } catch (DateTimeParseException e) {
            return null;
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
