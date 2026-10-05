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
                .baseUrl(baseUrl.replaceAll("/+$", ""))
                .defaultHeader(API_KEY_HEADER, apiKey)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

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

    private <T> Mono<T> wrapTransient(Throwable throwable, String what) {
        if (throwable instanceof QuotaExhausted || throwable instanceof BadRequest) {
            return Mono.error(throwable);
        }
        return Mono.error(new ServiceUnreachable(
                "Quote fetch failed for " + what + " after " + maxRetries + " retries: " + throwable.getMessage(),
                throwable));
    }

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
            JsonNode node = entry.hasNonNull("quote") && entry.get("quote").isObject() ? entry.get("quote") : entry;
            try {
                quotes.add(toQuote(node));
            } catch (Exception e) {
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

    private static JsonNode unwrapData(JsonNode body) {
        JsonNode data = body.get("data");
        return data != null && !data.isNull() ? data : body;
    }

    private QuoteResponse toQuote(JsonNode node) throws Exception {
        QuoteResponse q = objectMapper.treeToValue(node, QuoteResponse.class);
        return new QuoteResponse(toLocalSymbol(q.symbol()), q.price(), q.bid(), q.ask(), q.currency(),
                q.change(), q.changePercent(), q.previousClose(), q.marketState(), q.stale(), q.quoteAsOf());
    }

    private String toRemoteSymbol(String symbol) {
        if (symbol == null || symbolSuffix.isEmpty() || symbol.contains(".")) {
            return symbol;
        }
        return symbol + symbolSuffix;
    }

    private String toLocalSymbol(String remote) {
        if (remote != null && !symbolSuffix.isEmpty() && remote.endsWith(symbolSuffix)) {
            return remote.substring(0, remote.length() - symbolSuffix.length());
        }
        return remote;
    }

    public static class QuoteFetchException extends RuntimeException {
        public QuoteFetchException(String message) {
            super(message);
        }

        public QuoteFetchException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public static class ServiceUnreachable extends QuoteFetchException {
        public ServiceUnreachable(String message) {
            super(message);
        }

        public ServiceUnreachable(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public static class QuotaExhausted extends QuoteFetchException {
        public QuotaExhausted(String message) {
            super(message);
        }
    }

    public static class BadRequest extends QuoteFetchException {
        public BadRequest(String message) {
            super(message);
        }
    }
}
