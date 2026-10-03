package com.team1.trading.api.market;

import com.fasterxml.jackson.databind.JsonNode;
import com.team1.trading.api.mapper.CandleMapper.DailyCandleWrite;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Fetches daily history from Fauxnance's {@code GET /candles/{symbol}}.
 *
 * <p>That endpoint serves one symbol per request and daily candles only (there is no batch form of
 * it; only {@code /quotes} is batched), so one call returns the whole requested range for one
 * instrument. {@link CandleService} makes at most one such call per instrument per day.
 *
 * <p>The key goes in {@code x-api-key}; every body is {@code {"data": {"candles": [...]}, "meta":
 * ...}}; instruments are keyed {@code RELIANCE.NS} there and {@code RELIANCE} here.
 */
@Component
public class FauxnanceCandleClient {

    private static final Logger log = LoggerFactory.getLogger(FauxnanceCandleClient.class);

    private final RestClient restClient;
    private final String symbolSuffix;

    public FauxnanceCandleClient(@Value("${fauxnance.base-url}") String baseUrl,
                                 @Value("${fauxnance.api-key}") String apiKey,
                                 @Value("${fauxnance.symbol-suffix:.NS}") String symbolSuffix,
                                 @Value("${fauxnance.timeout-seconds:10}") int timeoutSeconds) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(timeoutSeconds));
        factory.setReadTimeout(Duration.ofSeconds(timeoutSeconds));
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .defaultHeader("x-api-key", apiKey)
                .defaultHeader("Accept", MediaType.APPLICATION_JSON_VALUE)
                .build();
        this.symbolSuffix = symbolSuffix == null ? "" : symbolSuffix.trim();
    }

    /**
     * @return the candles in ascending date order; empty when Fauxnance has none for the range
     * @throws CandleFetchException on a refusal (quota, unknown symbol), a 202 "backfill in
     *                              progress", an unreadable body, or a network failure
     */
    public List<DailyCandleWrite> fetchDaily(String symbol, LocalDate from, LocalDate to) {
        String remote = symbol.contains(".") || symbolSuffix.isEmpty() ? symbol : symbol + symbolSuffix;
        try {
            return restClient.get()
                    .uri(uri -> uri.path("/candles/{symbol}")
                            .queryParam("from", from)
                            .queryParam("to", to)
                            .queryParam("interval", "1d")
                            .build(remote))
                    .exchange((request, response) -> {
                        HttpStatusCode status = response.getStatusCode();
                        if (status.value() == 202) {
                            throw new CandleFetchException(
                                    "Fauxnance is still backfilling " + remote + "; try again later");
                        }
                        if (status.value() == 429) {
                            throw new CandleFetchException("Fauxnance daily quota exhausted");
                        }
                        if (!status.is2xxSuccessful()) {
                            throw new CandleFetchException("Fauxnance answered " + status.value() + " for " + remote);
                        }
                        return parse(symbol, response.bodyTo(JsonNode.class));
                    });
        } catch (CandleFetchException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new CandleFetchException("Could not fetch candles for " + remote + ": " + e.getMessage(), e);
        }
    }

    static List<DailyCandleWrite> parse(String symbol, JsonNode body) {
        JsonNode candles = body == null ? null : body.path("data").path("candles");
        if (candles == null || !candles.isArray()) {
            throw new CandleFetchException("Unrecognised candles response for " + symbol);
        }
        List<DailyCandleWrite> out = new ArrayList<>(candles.size());
        for (JsonNode node : candles) {
            try {
                DailyCandleWrite c = new DailyCandleWrite();
                c.setSymbol(symbol);
                c.setTradeDate(LocalDate.parse(node.path("date").asText()));
                c.setOpen(price(node, "open"));
                c.setHigh(price(node, "high"));
                c.setLow(price(node, "low"));
                c.setClose(price(node, "close"));
                c.setAdjClose(node.hasNonNull("adjclose") ? node.get("adjclose").decimalValue() : null);
                c.setVolume(node.hasNonNull("volume") && node.get("volume").isNumber() ? node.get("volume").asLong() : null);
                c.setSynthetic(node.path("synthetic").asBoolean(false));
                if (c.getHigh().compareTo(c.getLow()) < 0) {
                    throw new IllegalArgumentException("high below low");
                }
                out.add(c);
            } catch (RuntimeException e) {
                // One bad row (a missing price, a negative number, an odd date) must not cost the
                // other 250. The chart simply has a gap there.
                log.warn("Skipping an unusable candle for {}: {} ({})", symbol, node, e.getMessage());
            }
        }
        return out;
    }

    private static BigDecimal price(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isNumber() || value.decimalValue().signum() <= 0) {
            throw new IllegalArgumentException(field + " is missing or not positive");
        }
        return value.decimalValue();
    }

    /** A fetch that could not produce candles; the cause is for the log, not for the client. */
    public static class CandleFetchException extends RuntimeException {
        public CandleFetchException(String message) {
            super(message);
        }

        public CandleFetchException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
