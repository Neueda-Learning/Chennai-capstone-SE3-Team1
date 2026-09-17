package com.team1.executor.quote;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.executor.model.QuoteResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

@Component
public class FauxnanceQuoteClient {

    /**
     * The batch endpoint takes at most this many symbols and costs one request whatever the
     * symbol count. This is a property of the Fauxnance API, which is why it lives here and not
     * in the poller.
     */
    public static final int MAX_SYMBOLS_PER_REQUEST = 25;

    private static final String CALLER_FILL_PATH = "fill-path";
    private static final String CALLER_POLLER = "market-poller";

    private static final Logger log = LoggerFactory.getLogger(FauxnanceQuoteClient.class);

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final QuotaLedger quotaLedger;
    private final int timeoutSeconds;
    private final int maxRetries;
    private final long retryBackoffMs;

    public FauxnanceQuoteClient(
            @org.springframework.beans.factory.annotation.Value("${fauxnance.base-url}") String baseUrl,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.api-key}") String apiKey,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.timeout-seconds}") int timeoutSeconds,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.max-retries}") int maxRetries,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.retry-backoff-ms}") long retryBackoffMs,
            ObjectMapper objectMapper,
            QuotaLedger quotaLedger
    ) {
        this.timeoutSeconds = timeoutSeconds;
        this.maxRetries = maxRetries;
        this.retryBackoffMs = retryBackoffMs;
        this.objectMapper = objectMapper;
        this.quotaLedger = quotaLedger;

        this.webClient = WebClient.builder()
                .baseUrl(baseUrl)
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    /**
     * One symbol, one request. Used by the fill path, which needs a price fetched now rather than
     * whatever the poller last published.
     */
    public QuoteResponse getQuote(String symbol) {
        return webClient.get()
                .uri("/quotes/{symbol}", symbol)
                .retrieve()
                .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(),
                        response -> response.bodyToMono(String.class)
                                .flatMap(body -> Mono.error(new QuoteFetchException(
                                        "Failed to fetch quote for " + symbol + ": " + response.statusCode() + " " + body))))
                .bodyToMono(QuoteResponse.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .doOnSubscribe(subscription -> quotaLedger.record(CALLER_FILL_PATH))
                .retryWhen(Retry.backoff(maxRetries, Duration.ofMillis(retryBackoffMs))
                        .filter(throwable -> throwable instanceof WebClientResponseException
                                || throwable instanceof java.util.concurrent.TimeoutException))
                .onErrorResume(throwable -> Mono.error(new QuoteFetchException(
                        "Quote fetch failed for " + symbol + " after " + maxRetries + " retries: " + throwable.getMessage())))
                .block();
    }

    /**
     * Up to {@value #MAX_SYMBOLS_PER_REQUEST} symbols in one request, which is the quota
     * optimisation the poller exists on. Chunking above that limit is the caller's job, because
     * the caller is the one that has to account for the extra request.
     *
     * <p>Batching stops here. The poller publishes the returned quotes one Kafka message per
     * symbol: batching the HTTP call is a quota optimisation, batching the Kafka message would
     * put several symbols behind one key and destroy the per-symbol ordering the contract
     * promises.
     */
    public List<QuoteResponse> getQuotes(List<String> symbols) {
        if (symbols == null || symbols.isEmpty()) {
            return List.of();
        }
        if (symbols.size() > MAX_SYMBOLS_PER_REQUEST) {
            throw new IllegalArgumentException(
                    "The batch endpoint takes at most " + MAX_SYMBOLS_PER_REQUEST + " symbols, was given "
                            + symbols.size() + ". Chunk before calling, or the extra request is unaccounted for.");
        }

        String joined = String.join(",", symbols);
        JsonNode body = webClient.get()
                .uri(uriBuilder -> uriBuilder.path("/quotes").queryParam("symbols", joined).build())
                .retrieve()
                .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(),
                        response -> response.bodyToMono(String.class)
                                .flatMap(errorBody -> Mono.error(new QuoteFetchException(
                                        "Failed to fetch batch quotes for " + joined + ": " + response.statusCode() + " " + errorBody))))
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .doOnSubscribe(subscription -> quotaLedger.record(CALLER_POLLER))
                .retryWhen(Retry.backoff(maxRetries, Duration.ofMillis(retryBackoffMs))
                        .filter(throwable -> throwable instanceof WebClientResponseException
                                || throwable instanceof java.util.concurrent.TimeoutException))
                .onErrorMap(throwable -> throwable instanceof QuoteFetchException ? throwable
                        : new QuoteFetchException("Batch quote fetch failed for " + joined + " after "
                        + maxRetries + " retries: " + throwable.getMessage()))
                .block();

        return parseBatch(body, joined);
    }

    /**
     * Fauxnance has not pinned the batch response shape in anything we hold, so accept the three
     * it could reasonably be — a bare array, or an array under {@code quotes}, {@code data} or
     * {@code results} — rather than guessing one and failing loudly on the day it differs.
     */
    private List<QuoteResponse> parseBatch(JsonNode body, String requested) {
        if (body == null || body.isNull()) {
            throw new QuoteFetchException("Empty batch quote response for " + requested);
        }

        JsonNode array = locateQuoteArray(body);
        if (array == null) {
            throw new QuoteFetchException(
                    "Unrecognised batch quote response shape for " + requested + ", fields: " + body.fieldNames());
        }

        List<QuoteResponse> quotes = new ArrayList<>(array.size());
        for (JsonNode node : array) {
            try {
                quotes.add(objectMapper.treeToValue(node, QuoteResponse.class));
            } catch (Exception e) {
                // One unreadable entry does not cost us the other twenty-four.
                log.warn("Skipping an unreadable quote in the batch for {}: {}", requested, e.getMessage());
            }
        }
        return quotes;
    }

    private JsonNode locateQuoteArray(JsonNode body) {
        if (body.isArray()) {
            return body;
        }
        for (String field : List.of("quotes", "data", "results")) {
            JsonNode candidate = body.get(field);
            if (candidate != null && candidate.isArray()) {
                return candidate;
            }
        }
        if (body.hasNonNull("symbol")) {
            return objectMapper.createArrayNode().add(body);
        }
        return null;
    }

    public static class QuoteFetchException extends RuntimeException {
        public QuoteFetchException(String message) {
            super(message);
        }
    }
}
