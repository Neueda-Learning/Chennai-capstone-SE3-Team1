package com.team1.executor.poller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.eventbus.Envelope;
import com.team1.executor.model.QuoteResponse;
import com.team1.executor.quote.FauxnanceQuoteClient;
import com.team1.executor.quote.QuotaLedger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Component
public class MarketDataPoller {

    static final String MARKET_DATA_TOPIC = "market-data";

    private static final String SOURCE = "market-poller";
    private static final String EVENT_TYPE = "QUOTE";
    private static final int SCHEMA_VERSION = 1;

    private static final Logger log = LoggerFactory.getLogger(MarketDataPoller.class);

    private final SymbolUniverse symbolUniverse;
    private final FauxnanceQuoteClient quoteClient;
    private final QuotaLedger quotaLedger;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final ObjectMapper objectMapper;

    public MarketDataPoller(SymbolUniverse symbolUniverse,
                            FauxnanceQuoteClient quoteClient,
                            QuotaLedger quotaLedger,
                            KafkaTemplate<String, Object> kafkaTemplate,
                            ObjectMapper objectMapper) {
        this.symbolUniverse = symbolUniverse;
        this.quoteClient = quoteClient;
        this.quotaLedger = quotaLedger;
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
    }

    @Scheduled(fixedDelayString = "#{@pollerProperties.effectiveIntervalMillis}")
    public void pollOnce() {
        try {
            List<String> symbols = symbolUniverse.symbolsToPoll();
            if (symbols.isEmpty()) {
                log.debug("No active instruments; no quotes to poll and no quota spent");
                return;
            }

            List<List<String>> batches = batch(symbols);

            if (!quotaLedger.pollerMaySpend(batches.size())) {
                log.warn("Skipping this poll: {} request(s) would take today past the {} poller budget "
                                + "({} already spent). The fill path keeps its {} reserve.",
                        batches.size(),
                        PollingSchedule.POLLER_DAILY_BUDGET,
                        quotaLedger.spentToday(),
                        PollingSchedule.FILL_PATH_RESERVE);
                return;
            }

            int published = 0;
            for (List<String> chunk : batches) {
                published += fetchAndPublish(chunk);
            }

            log.debug("Polled {} symbol(s) in {} request(s), published {} message(s) to {}",
                    symbols.size(), batches.size(), published, MARKET_DATA_TOPIC);

        } catch (Exception e) {
            log.error("Poll cycle failed; the schedule continues and the next cycle will retry", e);
        }
    }

    private int fetchAndPublish(List<String> chunk) {
        List<QuoteResponse> quotes;
        try {
            quotes = quoteClient.getQuotes(chunk);
        } catch (RuntimeException e) {
            log.warn("Batch of {} symbol(s) failed, continuing with the rest: {}", chunk.size(), e.getMessage());
            return 0;
        }

        int published = 0;
        for (QuoteResponse quote : quotes) {
            if (publish(quote)) {
                published++;
            }
        }
        return published;
    }

    private boolean publish(QuoteResponse quote) {
        if (quote == null || quote.symbol() == null || quote.symbol().isBlank()) {
            log.warn("Dropping a quote with no symbol: it cannot be keyed, and an unkeyed message is "
                    + "spread across partitions with no ordering guarantee at all");
            return false;
        }

        Envelope envelope = new Envelope(
                UUID.randomUUID().toString(),
                EVENT_TYPE,
                Instant.now().toString(),
                SOURCE,
                SCHEMA_VERSION,
                objectMapper.valueToTree(quote)
        );

        kafkaTemplate.send(MARKET_DATA_TOPIC, quote.symbol(), envelope);
        return true;
    }

    static List<List<String>> batch(List<String> symbols) {
        int size = FauxnanceQuoteClient.MAX_SYMBOLS_PER_REQUEST;
        List<List<String>> batches = new ArrayList<>();
        for (int start = 0; start < symbols.size(); start += size) {
            batches.add(List.copyOf(symbols.subList(start, Math.min(start + size, symbols.size()))));
        }
        return batches;
    }
}
