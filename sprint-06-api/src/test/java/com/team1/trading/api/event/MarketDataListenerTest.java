package com.team1.trading.api.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.eventbus.Envelope;
import com.team1.trading.api.mapper.PositionMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;

import java.math.BigDecimal;

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
    private Acknowledgment ack;

    private MarketDataListener listener;

    @BeforeEach
    void setUp() {
        listener = new MarketDataListener(positionMapper);
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
}
