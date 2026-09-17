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

/**
 * Fetches stock quotes from Fauxnance API.
 *
 * Error handling strategy:
 * - HTTP 429 (quota exhausted): throw QuotaExhausted (permanent, don't retry)
 * - HTTP 4xx (bad request): throw BadRequest (permanent, don't retry)
 * - HTTP 5xx or timeout: throw ServiceUnreachable (transient, retry)
 * - Network error: throw ServiceUnreachable (transient, retry)
 *
 * Internal retries are handled by Retry backoff in WebClient.
 * OrderConsumer's ErrorClassifier classifies these into retry/dead-letter decisions.
 *
 * <p>Two callers share this client and the one Fauxnance key behind it: the fill path in
 * {@code OrderConsumer} ({@link #getQuote}) and the market-data poller ({@link #getQuotes}).
 * Every request is recorded against {@link QuotaLedger} under its caller's name so the poller
 * can stop spending before it eats the fill path's reserve.
 *
 * <p><strong>Wire facts, verified against the live gateway:</strong> the key goes in an
 * {@code x-api-key} header (a Bearer header is a 401); every body is wrapped in
 * {@code {"data": ..., "meta": ...}}; the batch body is {@code data.quotes[]} where each entry
 * carries the quote under {@code quote}; and the timestamp field is {@code asOf}. Symbols are
 * exchange-suffixed ({@code RELIANCE.NS}) while {@code instruments.instrument_id} is the bare
 * ticker, so this class translates on the way out and back and nothing else in the executor has
 * to know.
 */
@Component
public class FauxnanceQuoteClient {

    /**
     * The batch endpoint takes at most this many symbols and costs one request whatever the
     * symbol count. This is a property of the Fauxnance API, which is why it lives here and not
     * in the poller.
     */
    public static final int MAX_SYMBOLS_PER_REQUEST = 25;

    private static final String API_KEY_HEADER = "x-api-key";
    private static final String CALLER_FILL_PATH = "fill-path";
    private static final String CALLER_POLLER = "market-poller";

    private static final Logger log = LoggerFactory.getLogger(FauxnanceQuoteClient.class);

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final QuotaLedger quotaLedger;
    private final String symbolSuffix;
    private final int timeoutSeconds;
    private final int maxRetries;
    private final long retryBackoffMs;

    public FauxnanceQuoteClient(
            @org.springframework.beans.factory.annotation.Value("${fauxnance.base-url}") String baseUrl,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.api-key}") String apiKey,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.symbol-suffix:.NS}") String symbolSuffix,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.timeout-seconds}") int timeoutSeconds,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.max-retries}") int maxRetries,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.retry-backoff-ms}") long retryBackoffMs,
            ObjectMapper objectMapper,
            QuotaLedger quotaLedger
    ) {
        this.symbolSuffix = symbolSuffix == null ? "" : symbolSuffix.trim();
        this.timeoutSeconds = timeoutSeconds;
        this.maxRetries = maxRetries;
        this.retryBackoffMs = retryBackoffMs;
        this.objectMapper = objectMapper;
        this.quotaLedger = quotaLedger;

        this.webClient = WebClient.builder()
                .baseUrl(baseUrl)
                .defaultHeader(API_KEY_HEADER, apiKey)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    /**
     * Fetches a quote from Fauxnance API for the given symbol.
     *
     * One symbol, one request. Used by the fill path, which needs a price fetched now rather than
     * whatever the poller last published.
     *
     * Throws specific exception types that ErrorClassifier will handle:
     * - QuotaExhausted: HTTP 429, don't retry/dead-letter, reject order instead
     * - BadRequest: HTTP 4xx, don't retry/dead-letter, reject order instead
     * - ServiceUnreachable: HTTP 5xx/timeout/network, retry with backoff
     *
     * @param symbol The instrument id as stored (e.g., "INFY"); the exchange suffix is added here
     * @return Quote response, with {@code symbol} translated back to the instrument id
     * @throws QuotaExhausted if daily quota exhausted (HTTP 429)
     * @throws BadRequest if invalid request (HTTP 4xx except 429)
     * @throws ServiceUnreachable if transient failure (HTTP 5xx, timeout, network error)
     */
    public QuoteResponse getQuote(String symbol) {
        String remote = toRemoteSymbol(symbol);
        WebClient.ResponseSpec spec = webClient.get()
                .uri("/quotes/{symbol}", remote)
                .retrieve();

        JsonNode body = classifyErrors(spec, remote)
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .doOnSubscribe(subscription -> quotaLedger.record(CALLER_FILL_PATH))
                .retryWhen(Retry.backoff(maxRetries, Duration.ofMillis(retryBackoffMs))
                        .filter(throwable -> throwable instanceof WebClientResponseException
                                || throwable instanceof java.util.concurrent.TimeoutException))
                .onErrorResume(throwable -> wrapTransient(throwable, remote))
                .block();

        if (body == null || body.isNull()) {
            throw new QuoteFetchException("Empty quote response for " + remote);
        }
        try {
            return toQuote(unwrapData(body));
        } catch (Exception e) {
            throw new QuoteFetchException("Unreadable quote response for " + remote + ": " + e.getMessage(), e);
        }
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
     *
     * <p>Errors are classified the same way as {@link #getQuote}. The poller treats every
     * {@link QuoteFetchException} as one cycle with no ticks, so for it the distinction is only
     * what ends up in the log.
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

        String joined = String.join(",", symbols.stream().map(this::toRemoteSymbol).toList());
        WebClient.ResponseSpec spec = webClient.get()
                .uri(uriBuilder -> uriBuilder.path("/quotes").queryParam("symbols", joined).build())
                .retrieve();

        JsonNode body = classifyErrors(spec, joined)
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .doOnSubscribe(subscription -> quotaLedger.record(CALLER_POLLER))
                .retryWhen(Retry.backoff(maxRetries, Duration.ofMillis(retryBackoffMs))
                        .filter(throwable -> throwable instanceof WebClientResponseException
                                || throwable instanceof java.util.concurrent.TimeoutException))
                .onErrorResume(throwable -> wrapTransient(throwable, joined))
                .block();

        return parseBatch(body, joined);
    }

    /**
     * Maps HTTP status to the exception the caller's classifier expects: 429 is quota, any other
     * 4xx is our fault, 5xx is theirs and worth a retry.
     */
    private WebClient.ResponseSpec classifyErrors(WebClient.ResponseSpec spec, String what) {
        return spec
                .onStatus(status -> status.value() == 429,
                        response -> response.bodyToMono(String.class)
                                .flatMap(body -> Mono.error(new QuotaExhausted(
                                        "Daily quota exhausted for " + what + ": " + body))))
                .onStatus(status -> status.is4xxClientError(),
                        response -> response.bodyToMono(String.class)
                                .flatMap(body -> Mono.error(new BadRequest(
                                        "Bad request for " + what + ": " + response.statusCode() + " " + body))))
                .onStatus(status -> status.is5xxServerError(),
                        response -> response.bodyToMono(String.class)
                                .flatMap(body -> Mono.error(new ServiceUnreachable(
                                        "Fauxnance server error for " + what + ": " + response.statusCode() + " " + body))));
    }

    /** Permanent errors pass through unwrapped; everything else becomes ServiceUnreachable. */
    private <T> Mono<T> wrapTransient(Throwable throwable, String what) {
        if (throwable instanceof QuotaExhausted || throwable instanceof BadRequest) {
            return Mono.error(throwable);  // Don't wrap permanent errors
        }
        // Wrap transient errors as ServiceUnreachable
        return Mono.error(new ServiceUnreachable(
                "Quote fetch failed for " + what + " after " + maxRetries + " retries: " + throwable.getMessage(),
                throwable));
    }

    /**
     * The batch body is {@code {"data": {"quotes": [{"symbol", "source", "stale", "quote": {...}}]}}}.
     * Older guesses at the shape (a bare array, or an array under {@code quotes}/{@code data}/
     * {@code results}) are still accepted so a gateway change is a warning, not an outage.
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
        for (JsonNode entry : array) {
            // Each batch entry wraps the quote proper under "quote"; tolerate a flat entry too.
            JsonNode node = entry.hasNonNull("quote") && entry.get("quote").isObject() ? entry.get("quote") : entry;
            try {
                quotes.add(toQuote(node));
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
        JsonNode data = unwrapData(body);
        if (data.isArray()) {
            return data;
        }
        for (String field : List.of("quotes", "results")) {
            JsonNode candidate = data.get(field);
            if (candidate != null && candidate.isArray()) {
                return candidate;
            }
        }
        if (data.hasNonNull("symbol")) {
            return objectMapper.createArrayNode().add(data);
        }
        return null;
    }

    /** Every Fauxnance body is {@code {"data": ..., "meta": ...}}; hand back the data node. */
    private static JsonNode unwrapData(JsonNode body) {
        JsonNode data = body.get("data");
        return data != null && !data.isNull() ? data : body;
    }

    private QuoteResponse toQuote(JsonNode node) throws Exception {
        QuoteResponse q = objectMapper.treeToValue(node, QuoteResponse.class);
        return new QuoteResponse(toLocalSymbol(q.symbol()), q.price(), q.bid(), q.ask(), q.currency(),
                q.change(), q.changePercent(), q.previousClose(), q.marketState(), q.stale(), q.quoteAsOf());
    }

    /** RELIANCE -> RELIANCE.NS. A symbol that already carries an exchange is left alone. */
    private String toRemoteSymbol(String symbol) {
        if (symbol == null || symbolSuffix.isEmpty() || symbol.contains(".")) {
            return symbol;
        }
        return symbol + symbolSuffix;
    }

    /** RELIANCE.NS -> RELIANCE, so the rest of the executor keys on instrument_id. */
    private String toLocalSymbol(String remote) {
        if (remote != null && !symbolSuffix.isEmpty() && remote.endsWith(symbolSuffix)) {
            return remote.substring(0, remote.length() - symbolSuffix.length());
        }
        return remote;
    }

    /**
     * Base of every failure this client raises. The poller catches this and moves on to the next
     * batch; the fill path's ErrorClassifier looks at the subclasses below to decide between
     * retry, reject and dead-letter.
     */
    public static class QuoteFetchException extends RuntimeException {
        public QuoteFetchException(String message) {
            super(message);
        }

        public QuoteFetchException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * Quote fetch failed due to temporary issue (HTTP 5xx, timeout, network).
     * RETRYABLE: OrderConsumer will retry with backoff.
     */
    public static class ServiceUnreachable extends QuoteFetchException {
        public ServiceUnreachable(String message) {
            super(message);
        }

        public ServiceUnreachable(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * Quote fetch failed due to quota exhaustion (HTTP 429).
     * NOT RETRYABLE: OrderConsumer will reject order without retry/dead-letter.
     * Rationale: Quota resets at fixed time; retry won't help until then.
     */
    public static class QuotaExhausted extends QuoteFetchException {
        public QuotaExhausted(String message) {
            super(message);
        }
    }

    /**
     * Quote fetch failed due to bad request (HTTP 4xx, not 429).
     * NOT RETRYABLE: OrderConsumer will reject order without retry/dead-letter.
     * Rationale: Bad symbol, invalid range, etc. won't change on retry.
     */
    public static class BadRequest extends QuoteFetchException {
        public BadRequest(String message) {
            super(message);
        }
    }
}
