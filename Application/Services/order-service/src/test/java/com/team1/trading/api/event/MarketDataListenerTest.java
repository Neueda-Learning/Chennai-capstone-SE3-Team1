package com.team1.trading.api.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.eventbus.Envelope;
import com.team1.trading.api.mapper.MarketQuoteMapper;
import com.team1.trading.api.mapper.MarketQuoteMapper.QuoteInsert;
import com.team1.trading.api.mapper.PositionMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * The market-data listener, which is what keeps overall_gains from being permanently zero.
 */
@ExtendWith(MockitoExtension.class)
class MarketDataListenerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Mock
    private PositionMapper positionMapper;
    @Mock
    private MarketQuoteMapper marketQuoteMapper;
    @Mock
    private Acknowledgment ack;

    private MarketDataListener listener;

    @BeforeEach
    void setUp() {
        listener = new MarketDataListener(positionMapper, marketQuoteMapper);
    }

    private ConsumerRecord<String, Envelope> record(String eventType, String payloadJson) {
        Envelope envelope;
        try {
            envelope = new Envelope("e-1", eventType, "2026-09-28T09:15:00Z", "market-poller", 1,
                    payloadJson == null ? null : MAPPER.readTree(payloadJson));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return new ConsumerRecord<>("market-data", 0, 0L, "RELIANCE", envelope);
    }

    @Test
    @DisplayName("A quote marks every holding of that symbol to the published price")
    void quoteMarksHoldings() {
        given(positionMapper.markToMarket(eq("RELIANCE"), any())).willReturn(2);

        listener.onQuote(record("QUOTE", """
                {"symbol":"RELIANCE","price":1244.09,"currency":"INR"}"""), ack);

        verify(positionMapper).markToMarket("RELIANCE", new BigDecimal("1244.09"));
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("An event that is not a QUOTE is committed and otherwise ignored")
    void nonQuoteIsSkipped() {
        listener.onQuote(record("ORDER_FILLED", """
                {"symbol":"RELIANCE","price":1244.09}"""), ack);

        verify(positionMapper, never()).markToMarket(any(), any());
        verify(ack).acknowledge();   // committing it stops the partition stalling on it
    }

    @Test
    @DisplayName("A quote with no price is dropped rather than written as a zero gain")
    void missingPriceIsDropped() {
        listener.onQuote(record("QUOTE", """
                {"symbol":"RELIANCE","currency":"INR"}"""), ack);

        verify(positionMapper, never()).markToMarket(any(), any());
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("A non-positive price is refused: it would invert every holding's gain")
    void nonPositivePriceIsDropped() {
        listener.onQuote(record("QUOTE", """
                {"symbol":"RELIANCE","price":0}"""), ack);

        verify(positionMapper, never()).markToMarket(any(), any());
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("A failed update does not stall the partition behind one bad quote")
    void databaseFailureStillCommits() {
        willThrow(new RuntimeException("database down"))
                .given(positionMapper).markToMarket(any(), any());

        listener.onQuote(record("QUOTE", """
                {"symbol":"RELIANCE","price":1244.09}"""), ack);

        // the next cycle republishes a fresher price a minute later, so dropping this one
        // costs less than blocking every later quote for the symbol
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("Every usable quote is also recorded for the market screen, with its full detail")
    void quoteIsRecorded() {
        listener.onQuote(record("QUOTE", """
                {"symbol":"RELIANCE","price":1244.09,"bid":1244.0,"ask":1244.2,"currency":"INR",
                 "change":3.5,"changePercent":0.28,"previousClose":1240.59,"marketState":"REGULAR",
                 "stale":false,"quoteAsOf":"2026-09-28T09:15:00Z"}"""), ack);

        ArgumentCaptor<QuoteInsert> captor = ArgumentCaptor.forClass(QuoteInsert.class);
        verify(marketQuoteMapper).insert(captor.capture());
        QuoteInsert saved = captor.getValue();
        assertThat(saved.getSymbol()).isEqualTo("RELIANCE");
        assertThat(saved.getPrice()).isEqualByComparingTo("1244.09");
        assertThat(saved.getBid()).isEqualByComparingTo("1244.0");
        assertThat(saved.getAsk()).isEqualByComparingTo("1244.2");
        assertThat(saved.getMarketState()).isEqualTo("REGULAR");
        assertThat(saved.isStale()).isFalse();
        assertThat(saved.getQuoteAsOf().toInstant()).isEqualTo(java.time.Instant.parse("2026-09-28T09:15:00Z"));
        verify(marketQuoteMapper).deleteOlderThan("RELIANCE", MarketDataListener.RETENTION_DAYS);
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("A quote with only a price is still recorded; the optional fields are simply null")
    void minimalQuoteIsRecorded() {
        listener.onQuote(record("QUOTE", """
                {"symbol":"TCS","price":3300.5,"quoteAsOf":"not-a-date"}"""), ack);

        ArgumentCaptor<QuoteInsert> captor = ArgumentCaptor.forClass(QuoteInsert.class);
        verify(marketQuoteMapper).insert(captor.capture());
        assertThat(captor.getValue().getBid()).isNull();
        assertThat(captor.getValue().getQuoteAsOf()).isNull();
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("Dropped quotes are not recorded")
    void droppedQuoteIsNotRecorded() {
        listener.onQuote(record("QUOTE", """
                {"symbol":"RELIANCE","price":0}"""), ack);

        verify(marketQuoteMapper, never()).insert(any());
    }

    @Test
    @DisplayName("A failure recording the quote never stops gains being marked, and still commits")
    void recordFailureDoesNotStopMarking() {
        willThrow(new RuntimeException("fk violation")).given(marketQuoteMapper).insert(any());

        listener.onQuote(record("QUOTE", """
                {"symbol":"RELIANCE","price":1244.09}"""), ack);

        verify(positionMapper).markToMarket("RELIANCE", new BigDecimal("1244.09"));
        verify(ack).acknowledge();
    }
}
