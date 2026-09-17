package com.team1.executor.quote;

import com.team1.executor.model.QuoteResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.time.Duration;

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
 */
@Component
public class FauxnanceQuoteClient {

    private final WebClient webClient;
    private final int timeoutSeconds;
    private final int maxRetries;
    private final long retryBackoffMs;

    public FauxnanceQuoteClient(
            @org.springframework.beans.factory.annotation.Value("${fauxnance.base-url}") String baseUrl,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.api-key}") String apiKey,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.timeout-seconds}") int timeoutSeconds,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.max-retries}") int maxRetries,
            @org.springframework.beans.factory.annotation.Value("${fauxnance.retry-backoff-ms}") long retryBackoffMs
    ) {
        this.timeoutSeconds = timeoutSeconds;
        this.maxRetries = maxRetries;
        this.retryBackoffMs = retryBackoffMs;

        this.webClient = WebClient.builder()
                .baseUrl(baseUrl)
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    /**
     * Fetches a quote from Fauxnance API for the given symbol.
     * 
     * Throws specific exception types that ErrorClassifier will handle:
     * - QuotaExhausted: HTTP 429, don't retry/dead-letter, reject order instead
     * - BadRequest: HTTP 4xx, don't retry/dead-letter, reject order instead
     * - ServiceUnreachable: HTTP 5xx/timeout/network, retry with backoff
     * 
     * @param symbol The stock symbol (e.g., "INFY.NS")
     * @return Quote response
     * @throws QuotaExhausted if daily quota exhausted (HTTP 429)
     * @throws BadRequest if invalid request (HTTP 4xx except 429)
     * @throws ServiceUnreachable if transient failure (HTTP 5xx, timeout, network error)
     */
    public QuoteResponse getQuote(String symbol) {
        return webClient.get()
                .uri("/quotes/{symbol}", symbol)
                .retrieve()
                .onStatus(status -> status.value() == 429,
                        response -> response.bodyToMono(String.class)
                                .flatMap(body -> Mono.error(new QuotaExhausted(
                                        "Daily quota exhausted for " + symbol + ": " + body))))
                .onStatus(status -> status.is4xxClientError(),
                        response -> response.bodyToMono(String.class)
                                .flatMap(body -> Mono.error(new BadRequest(
                                        "Bad request for " + symbol + ": " + response.statusCode() + " " + body))))
                .onStatus(status -> status.is5xxServerError(),
                        response -> response.bodyToMono(String.class)
                                .flatMap(body -> Mono.error(new ServiceUnreachable(
                                        "Fauxnance server error for " + symbol + ": " + response.statusCode() + " " + body))))
                .bodyToMono(QuoteResponse.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .retryWhen(Retry.backoff(maxRetries, Duration.ofMillis(retryBackoffMs))
                        .filter(throwable -> throwable instanceof WebClientResponseException
                                || throwable instanceof java.util.concurrent.TimeoutException))
                .onErrorResume(throwable -> {
                    if (throwable instanceof QuotaExhausted || throwable instanceof BadRequest) {
                        return Mono.error(throwable);  // Don't wrap permanent errors
                    }
                    // Wrap transient errors as ServiceUnreachable
                    return Mono.error(new ServiceUnreachable(
                            "Quote fetch failed for " + symbol + " after " + maxRetries + " retries: " + throwable.getMessage(),
                            throwable));
                })
                .block();
    }

    /**
     * Quote fetch failed due to temporary issue (HTTP 5xx, timeout, network).
     * RETRYABLE: OrderConsumer will retry with backoff.
     */
    public static class ServiceUnreachable extends RuntimeException {
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
    public static class QuotaExhausted extends RuntimeException {
        public QuotaExhausted(String message) {
            super(message);
        }
    }

    /**
     * Quote fetch failed due to bad request (HTTP 4xx, not 429).
     * NOT RETRYABLE: OrderConsumer will reject order without retry/dead-letter.
     * Rationale: Bad symbol, invalid range, etc. won't change on retry.
     */
    public static class BadRequest extends RuntimeException {
        public BadRequest(String message) {
            super(message);
        }
    }
}