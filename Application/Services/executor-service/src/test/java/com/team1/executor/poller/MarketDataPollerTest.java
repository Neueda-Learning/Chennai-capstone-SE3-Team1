package com.team1.executor.poller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.team1.eventbus.Envelope;
import com.team1.executor.model.QuoteResponse;
import com.team1.executor.quote.FauxnanceQuoteClient;
import com.team1.executor.quote.QuotaLedger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MarketDataPollerTest {

    @Mock
    private SymbolUniverse symbolUniverse;
    @Mock
    private FauxnanceQuoteClient quoteClient;
    @Mock
    private QuotaLedger quotaLedger;
    @Mock
    private KafkaTemplate<String, Object> kafkaTemplate;

    @Captor
    private ArgumentCaptor<List<String>> batchCaptor;
    @Captor
    private ArgumentCaptor<String> keyCaptor;
    @Captor
    private ArgumentCaptor<Object> valueCaptor;

    // Configured as the executor configures it, so that what this test asserts about the payload
    // is what actually reaches the topic.
    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    private MarketDataPoller poller;

    @BeforeEach
    void setUp() {
        poller = new MarketDataPoller(symbolUniverse, quoteClient, quotaLedger, kafkaTemplate, objectMapper);
    }

    private static QuoteResponse quoteFor(String symbol) {
        return new QuoteResponse(
                symbol,
                new BigDecimal("232.71"),
                new BigDecimal("232.65"),
                new BigDecimal("232.77"),
                "USD",
                new BigDecimal("0.21"),
                new BigDecimal("0.09"),
                new BigDecimal("232.50"),
                "open",
                false,
                Instant.parse("2026-09-28T09:14:58Z"));
    }

    private static List<String> symbols(int count) {
        return IntStream.range(0, count).mapToObj(i -> String.format("SYM%03d", i)).toList();
    }

    // --- a batch of up to 25 symbols is fetched in one request ---------------------------------

    @Test
    void twentyFiveSymbolsAreFetchedInOneRequest() {
        List<String> universe = symbols(25);
        when(symbolUniverse.symbolsToPoll()).thenReturn(universe);
        when(quotaLedger.pollerMaySpend(anyInt())).thenReturn(true);
        when(quoteClient.getQuotes(any())).thenReturn(universe.stream().map(MarketDataPollerTest::quoteFor).toList());

        poller.pollOnce();

        verify(quoteClient, times(1)).getQuotes(batchCaptor.capture());
        assertThat(batchCaptor.getValue()).hasSize(25).containsExactlyElementsOf(universe);
    }

    @Test
    void fourSymbolsAreStillOneRequest() {
        List<String> universe = List.of("ICICIBANK", "INFY", "ITC", "RELIANCE");
        when(symbolUniverse.symbolsToPoll()).thenReturn(universe);
        when(quotaLedger.pollerMaySpend(anyInt())).thenReturn(true);
        when(quoteClient.getQuotes(any())).thenReturn(universe.stream().map(MarketDataPollerTest::quoteFor).toList());

        poller.pollOnce();

        verify(quoteClient, times(1)).getQuotes(batchCaptor.capture());
        assertThat(batchCaptor.getValue()).containsExactly("ICICIBANK", "INFY", "ITC", "RELIANCE");
        verify(quotaLedger).pollerMaySpend(1);
    }

    @Test
    void thirtySymbolsAreFetchedInTwoRequestsOfTwentyFiveAndFive() {
        List<String> universe = symbols(30);
        when(symbolUniverse.symbolsToPoll()).thenReturn(universe);
        when(quotaLedger.pollerMaySpend(anyInt())).thenReturn(true);
        when(quoteClient.getQuotes(any())).thenReturn(List.of());

        poller.pollOnce();

        verify(quoteClient, times(2)).getQuotes(batchCaptor.capture());
        assertThat(batchCaptor.getAllValues().get(0)).hasSize(25);
        assertThat(batchCaptor.getAllValues().get(1)).hasSize(5);
        // The second batch is the second request, and the ledger was asked about both.
        verify(quotaLedger).pollerMaySpend(2);
    }

    @Test
    void nothingHeldSpendsNothing() {
        when(symbolUniverse.symbolsToPoll()).thenReturn(List.of());

        poller.pollOnce();

        verifyNoInteractions(quoteClient);
        verifyNoInteractions(kafkaTemplate);
    }

    // --- each quote is published as its own message keyed by symbol ----------------------------

    @Test
    void eachQuoteIsPublishedAsItsOwnMessageKeyedBySymbol() {
        List<String> universe = List.of("RELIANCE", "INFY", "ITC");
        when(symbolUniverse.symbolsToPoll()).thenReturn(universe);
        when(quotaLedger.pollerMaySpend(anyInt())).thenReturn(true);
        when(quoteClient.getQuotes(any())).thenReturn(universe.stream().map(MarketDataPollerTest::quoteFor).toList());

        poller.pollOnce();

        // One HTTP request, three Kafka messages. That asymmetry is the whole design.
        verify(quoteClient, times(1)).getQuotes(any());
        verify(kafkaTemplate, times(3))
                .send(eq(MarketDataPoller.MARKET_DATA_TOPIC), keyCaptor.capture(), valueCaptor.capture());

        assertThat(keyCaptor.getAllValues()).containsExactly("RELIANCE", "INFY", "ITC");

        for (int i = 0; i < 3; i++) {
            Envelope envelope = (Envelope) valueCaptor.getAllValues().get(i);
            assertThat(envelope.eventType()).isEqualTo("QUOTE");
            assertThat(envelope.source()).isEqualTo("market-poller");
            assertThat(envelope.schemaVersion()).isEqualTo(1);
            assertThat(envelope.eventId()).isNotBlank();
            // The key and the payload must name the same symbol, or a consumer keying off the
            // partition reads a price for something else.
            assertThat(envelope.payload().get("symbol").asText()).isEqualTo(keyCaptor.getAllValues().get(i));
        }
    }

    @Test
    void thirtySymbolsAcrossTwoRequestsStillProduceThirtyMessages() {
        List<String> universe = symbols(30);
        when(symbolUniverse.symbolsToPoll()).thenReturn(universe);
        when(quotaLedger.pollerMaySpend(anyInt())).thenReturn(true);
        when(quoteClient.getQuotes(any()))
                .thenAnswer(invocation -> invocation.<List<String>>getArgument(0).stream()
                        .map(MarketDataPollerTest::quoteFor).toList());

        poller.pollOnce();

        verify(kafkaTemplate, times(30)).send(eq(MarketDataPoller.MARKET_DATA_TOPIC), keyCaptor.capture(), any());
        assertThat(keyCaptor.getAllValues()).containsExactlyElementsOf(universe).doesNotHaveDuplicates();
    }

    @Test
    void thePayloadCarriesTheContractedQuoteFields() {
        when(symbolUniverse.symbolsToPoll()).thenReturn(List.of("RELIANCE"));
        when(quotaLedger.pollerMaySpend(anyInt())).thenReturn(true);
        when(quoteClient.getQuotes(any())).thenReturn(List.of(quoteFor("RELIANCE")));

        poller.pollOnce();

        verify(kafkaTemplate).send(anyString(), anyString(), valueCaptor.capture());
        Envelope envelope = (Envelope) valueCaptor.getValue();

        assertThat(envelope.payload().get("price").decimalValue()).isEqualByComparingTo("232.71");
        assertThat(envelope.payload().get("bid").decimalValue()).isEqualByComparingTo("232.65");
        assertThat(envelope.payload().get("ask").decimalValue()).isEqualByComparingTo("232.77");
        assertThat(envelope.payload().get("marketState").asText()).isEqualTo("open");
        assertThat(envelope.payload().get("stale").asBoolean()).isFalse();
        // quoteAsOf is the observation time from Fauxnance, not the poll time; eventTime is ours.
        assertThat(envelope.payload().get("quoteAsOf").asText()).startsWith("2026-09-28T09:14:58");
        assertThat(envelope.eventTime()).isNotEqualTo(envelope.payload().get("quoteAsOf").asText());
    }

    @Test
    void aQuoteWithoutASymbolIsDroppedRatherThanPublishedUnkeyed() {
        QuoteResponse unkeyable = new QuoteResponse(
                null, BigDecimal.ONE, BigDecimal.ONE, BigDecimal.ONE, "USD",
                null, null, null, "open", false, Instant.now());

        when(symbolUniverse.symbolsToPoll()).thenReturn(List.of("RELIANCE", "INFY"));
        when(quotaLedger.pollerMaySpend(anyInt())).thenReturn(true);
        when(quoteClient.getQuotes(any())).thenReturn(List.of(quoteFor("RELIANCE"), unkeyable));

        poller.pollOnce();

        verify(kafkaTemplate, times(1)).send(anyString(), keyCaptor.capture(), any());
        assertThat(keyCaptor.getValue()).isEqualTo("RELIANCE");
    }

    // --- the interval stays inside the daily quota ---------------------------------------------

    @Test
    void thePollIsSkippedWhenItWouldEatTheFillPathsReserve() {
        when(symbolUniverse.symbolsToPoll()).thenReturn(List.of("RELIANCE", "INFY"));
        when(quotaLedger.pollerMaySpend(1)).thenReturn(false);
        when(quotaLedger.spentToday()).thenReturn(PollingSchedule.POLLER_DAILY_BUDGET);

        poller.pollOnce();

        // No request, no message. The fill path keeps what is left of the key.
        verify(quoteClient, never()).getQuotes(any());
        verifyNoInteractions(kafkaTemplate);
    }

    // --- a failed cycle costs one cycle, never the schedule ------------------------------------

    @Test
    void aFailingBatchDoesNotEscapeTheScheduledMethod() {
        when(symbolUniverse.symbolsToPoll()).thenReturn(List.of("RELIANCE"));
        when(quotaLedger.pollerMaySpend(anyInt())).thenReturn(true);
        when(quoteClient.getQuotes(any()))
                .thenThrow(new FauxnanceQuoteClient.QuoteFetchException("Fauxnance is down"));

        assertThatCode(() -> poller.pollOnce()).doesNotThrowAnyException();
        verifyNoInteractions(kafkaTemplate);
    }

    @Test
    void aFailingBatchDoesNotCostTheBatchesAfterIt() {
        List<String> universe = symbols(30);
        when(symbolUniverse.symbolsToPoll()).thenReturn(universe);
        when(quotaLedger.pollerMaySpend(anyInt())).thenReturn(true);
        when(quoteClient.getQuotes(any()))
                .thenThrow(new FauxnanceQuoteClient.QuoteFetchException("first batch failed"))
                .thenReturn(List.of(quoteFor("SYM025")));

        poller.pollOnce();

        verify(quoteClient, times(2)).getQuotes(any());
        verify(kafkaTemplate, times(1)).send(anyString(), eq("SYM025"), any());
    }

    @Test
    void aBrokenSymbolUniverseDoesNotEscapeTheScheduledMethod() {
        when(symbolUniverse.symbolsToPoll()).thenThrow(new IllegalStateException("database is gone"));

        assertThatCode(() -> poller.pollOnce()).doesNotThrowAnyException();
        verifyNoInteractions(quoteClient);
    }

    // --- batching itself ------------------------------------------------------------------------

    @Test
    void batchSplitsOnTheApiLimitAndNotSomewhereElse() {
        assertThat(MarketDataPoller.batch(symbols(0))).isEmpty();
        assertThat(MarketDataPoller.batch(symbols(1))).hasSize(1);
        assertThat(MarketDataPoller.batch(symbols(25))).hasSize(1);
        assertThat(MarketDataPoller.batch(symbols(26))).hasSize(2);
        assertThat(MarketDataPoller.batch(symbols(50))).hasSize(2);
        assertThat(MarketDataPoller.batch(symbols(51))).hasSize(3);
    }

    @Test
    void batchingLosesNoSymbolAndDuplicatesNone() {
        List<String> universe = symbols(57);

        List<String> flattened = MarketDataPoller.batch(universe).stream().flatMap(List::stream).toList();

        assertThat(flattened).containsExactlyElementsOf(universe);
    }
}
