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

/**
 * Manufactures the price stream Fauxnance does not have.
 *
 * <p>Fauxnance serves delayed quotes over HTTP with no WebSocket and no server-sent events. The
 * Sprint 10 extensions that read prices need a stream, so this component makes one: it asks for
 * the held symbols in batches of {@value FauxnanceQuoteClient#MAX_SYMBOLS_PER_REQUEST} and fans
 * the answer out onto {@code market-data}, one message per symbol, keyed by symbol.
 *
 * <p><strong>One message per symbol, never one per batch.</strong> Batching the HTTP call is a
 * quota optimisation and it is correct. Batching the Kafka message would put several symbols
 * behind one key, which sends all of them to one symbol's partition and destroys the per-symbol
 * ordering {@code market-data} exists to provide — a consumer would be free to see an old quote
 * for one symbol after a newer one. The two look like the same decision and are not.
 *
 * <p>This is not on the order path. It does not start a poll because an order arrived, and
 * {@code OrderConsumer} does not wait for a poll to finish. The only thing the two share is
 * {@link QuotaLedger}.
 */
@Component
public class MarketDataPoller {

    static final String MARKET_DATA_TOPIC = "market-data";

    /**
     * The contract names the producing component, not the container it shipped in, so quotes
     * carry {@code market-poller} even though this runs inside the Trade Executor.
     */
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

    /**
     * One poll cycle.
     *
     * <p>Nothing escapes this method. Sharing a process is not sharing a lifecycle: a
     * {@code @Scheduled} method that throws is not rescheduled, and a poller that quietly stopped
     * inside a running container is harder to notice than one whose container exited. A failed
     * cycle must cost us one cycle, never the schedule.
     */
    @Scheduled(fixedDelayString = "#{@pollerProperties.effectiveIntervalMillis}")
    public void pollOnce() {
        try {
            List<String> symbols = symbolUniverse.symbolsToPoll();
            if (symbols.isEmpty()) {
                log.debug("Nothing held or watched; no quotes to poll and no quota spent");
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
            // One failed batch must not cost the batches after it. Fauxnance being down is a
            // business outcome for the fill path, and here it is simply a cycle with no ticks.
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

    /** Splits the universe into requests. One batch is one request, whatever the symbol count. */
    static List<List<String>> batch(List<String> symbols) {
        int size = FauxnanceQuoteClient.MAX_SYMBOLS_PER_REQUEST;
        List<List<String>> batches = new ArrayList<>();
        for (int start = 0; start < symbols.size(); start += size) {
            batches.add(List.copyOf(symbols.subList(start, Math.min(start + size, symbols.size()))));
        }
        return batches;
    }
}
