package com.team1.trading.api.watchlists;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.eventbus.Envelope;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;

import java.lang.reflect.Method;
import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
class MarketDataAlertListenerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Mock
    private AlertEvaluator evaluator;
    @Mock
    private Acknowledgment ack;

    private MarketDataAlertListener listener;

    @BeforeEach
    void setUp() {
        listener = new MarketDataAlertListener(evaluator);
    }

    private static ConsumerRecord<String, Envelope> record(String eventType, String payloadJson) {
        try {
            Envelope envelope = new Envelope("ev-1", eventType, "2026-10-06T09:15:00Z", "market-data-service", 1,
                    payloadJson == null ? null : MAPPER.readTree(payloadJson));
            return new ConsumerRecord<>("market-data", 0, 0L, "TCS", envelope);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("The listener reads market-data in its own group, watchlist-service")
    void ownGroup() throws Exception {
        Method method = MarketDataAlertListener.class.getMethod("onQuote", ConsumerRecord.class, Acknowledgment.class);

        KafkaListener annotation = method.getAnnotation(KafkaListener.class);

        assertThat(annotation.groupId()).isEqualTo("watchlist-service");
        assertThat(annotation.topics()).containsExactly("market-data");
    }

    @Test
    @DisplayName("A live quote is evaluated against the armed alerts and only then acknowledged")
    void evaluatedThenAcknowledged() {
        listener.onQuote(record("QUOTE", "{\"symbol\":\"TCS\",\"price\":3501.25,\"stale\":false}"), ack);

        var order = inOrder(evaluator, ack);
        order.verify(evaluator).evaluate("TCS", new BigDecimal("3501.25"));
        order.verify(ack).acknowledge();
    }

    @Test
    @DisplayName("The symbol is trimmed and upper-cased before it is matched")
    void symbolIsNormalised() {
        listener.onQuote(record("QUOTE", "{\"symbol\":\" tcs \",\"price\":10}"), ack);

        verify(evaluator).evaluate("TCS", new BigDecimal("10"));
    }

    @Test
    @DisplayName("A stale quote is acknowledged without being evaluated, so a replayed price cannot fire an alert")
    void staleIsSkipped() {
        listener.onQuote(record("QUOTE", "{\"symbol\":\"TCS\",\"price\":3501.25,\"stale\":true}"), ack);

        verifyNoInteractions(evaluator);
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("Anything that is not a usable QUOTE is acknowledged and skipped")
    void unusableEventsAreSkipped() {
        listener.onQuote(record("HEARTBEAT", "{\"symbol\":\"TCS\",\"price\":1}"), ack);
        listener.onQuote(record("QUOTE", "{\"price\":1}"), ack);
        listener.onQuote(record("QUOTE", "{\"symbol\":\"TCS\"}"), ack);
        listener.onQuote(record("QUOTE", "{\"symbol\":\"TCS\",\"price\":\"abc\"}"), ack);
        listener.onQuote(record("QUOTE", "{\"symbol\":\"TCS\",\"price\":0}"), ack);
        listener.onQuote(record("QUOTE", "{\"symbol\":\"TCS\",\"price\":-4}"), ack);
        listener.onQuote(record("QUOTE", "{\"symbol\":\"TCS\",\"price\":123456789012345.5}"), ack);
        listener.onQuote(record("QUOTE", "{\"symbol\":\"" + "X".repeat(21) + "\",\"price\":1}"), ack);
        listener.onQuote(record("QUOTE", null), ack);

        verifyNoInteractions(evaluator);
        verify(ack, org.mockito.Mockito.times(9)).acknowledge();
        verify(ack, never()).nack(any(java.time.Duration.class));
    }

    @Test
    @DisplayName("A database failure is not acknowledged: the quote is redelivered in 5 seconds")
    void databaseFailureIsRetried() {
        given(evaluator.evaluate(anyString(), any())).willThrow(new DataAccessResourceFailureException("db down"));

        listener.onQuote(record("QUOTE", "{\"symbol\":\"TCS\",\"price\":3501.25}"), ack);

        verify(ack).nack(MarketDataAlertListener.RETRY_AFTER);
        verify(ack, never()).acknowledge();
    }

    @Test
    @DisplayName("Any other failure is logged and the quote skipped so one bad record cannot block the partition")
    void otherFailureIsSkipped() {
        given(evaluator.evaluate(anyString(), any())).willThrow(new IllegalStateException("boom"));

        listener.onQuote(record("QUOTE", "{\"symbol\":\"TCS\",\"price\":3501.25}"), ack);

        verify(ack).acknowledge();
        verify(ack, never()).nack(any(java.time.Duration.class));
    }
}
