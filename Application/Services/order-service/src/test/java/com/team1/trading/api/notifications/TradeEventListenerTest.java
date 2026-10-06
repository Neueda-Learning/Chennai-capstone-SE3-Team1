package com.team1.trading.api.notifications;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.eventbus.Envelope;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;

import java.lang.reflect.Method;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
class TradeEventListenerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String PAYLOAD = "{\"orderId\":\"o-1\",\"accountId\":7,\"symbol\":\"TCS\",\"side\":\"BUY\","
            + "\"quantity\":3,\"price\":3500.00,\"executedPrice\":3501.25,\"status\":\"FILLED\","
            + "\"cashDelta\":-10503.75,\"password\":\"hunter2\"}";

    @Mock
    private NotificationRecorder recorder;
    @Mock
    private NotificationDispatcher dispatcher;
    @Mock
    private Acknowledgment ack;

    private TradeEventListener listener;

    @BeforeEach
    void setUp() {
        listener = new TradeEventListener(recorder, dispatcher);
    }

    private ConsumerRecord<String, Envelope> record(String eventId, String eventType, String payloadJson) {
        try {
            Envelope envelope = new Envelope(eventId, eventType, "2026-10-06T09:15:00Z", "order-service", 1,
                    payloadJson == null ? null : MAPPER.readTree(payloadJson));
            return new ConsumerRecord<>("trade-events", 0, 0L, "7", envelope);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("The listener reads trade-events in its own group, notification-service")
    void ownGroup() throws Exception {
        Method method = TradeEventListener.class.getMethod("onTradeEvent", ConsumerRecord.class, Acknowledgment.class);

        KafkaListener annotation = method.getAnnotation(KafkaListener.class);

        assertThat(annotation.groupId()).isEqualTo("notification-service");
        assertThat(annotation.topics()).containsExactly("trade-events");
    }

    @Test
    @DisplayName("A fill is recorded and only then is the offset acknowledged")
    void filledIsRecordedThenAcknowledged() {
        given(recorder.accountExists(7L)).willReturn(true);

        listener.onTradeEvent(record("ev-1", "ORDER_FILLED", PAYLOAD), ack);

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        var inOrder = org.mockito.Mockito.inOrder(recorder, ack);
        inOrder.verify(recorder).record(eq("ev-1"), eq(7L), eq(NotificationKind.ORDER_FILLED), payload.capture());
        inOrder.verify(ack).acknowledge();
        assertThat(payload.getValue()).contains("\"symbol\":\"TCS\"").contains("\"executedPrice\":\"3501.25\"")
                .doesNotContain("hunter2").doesNotContain("cashDelta");
    }

    @Test
    @DisplayName("A newly queued notification is dispatched at once, not at the next poll")
    void queuedIsDispatchedPromptly() {
        given(recorder.accountExists(7L)).willReturn(true);
        given(recorder.record(eq("ev-q"), eq(7L), eq(NotificationKind.ORDER_FILLED), anyString()))
                .willReturn(new NotificationRecorder.Recorded(NotificationStatus.QUEUED, true));

        listener.onTradeEvent(record("ev-q", "ORDER_FILLED", PAYLOAD), ack);

        verify(dispatcher).dispatchSoon();
    }

    @Test
    @DisplayName("A held (no channel yet) or replayed notification triggers no dispatch")
    void heldOrReplayedIsNotDispatched() {
        given(recorder.accountExists(7L)).willReturn(true);
        given(recorder.record(eq("ev-h"), anyLong(), any(), anyString()))
                .willReturn(new NotificationRecorder.Recorded(NotificationStatus.PENDING_CHANNEL, true));
        given(recorder.record(eq("ev-r"), anyLong(), any(), anyString()))
                .willReturn(new NotificationRecorder.Recorded(NotificationStatus.QUEUED, false));

        listener.onTradeEvent(record("ev-h", "ORDER_FILLED", PAYLOAD), ack);
        listener.onTradeEvent(record("ev-r", "ORDER_FILLED", PAYLOAD), ack);

        verifyNoInteractions(dispatcher);
    }

    @Test
    @DisplayName("Rejections and cancellations are recorded the same way")
    void rejectedAndCancelled() {
        given(recorder.accountExists(7L)).willReturn(true);

        listener.onTradeEvent(record("ev-2", "ORDER_REJECTED", PAYLOAD), ack);
        listener.onTradeEvent(record("ev-3", "ORDER_CANCELLED", PAYLOAD), ack);

        verify(recorder).record(eq("ev-2"), eq(7L), eq(NotificationKind.ORDER_REJECTED), anyString());
        verify(recorder).record(eq("ev-3"), eq(7L), eq(NotificationKind.ORDER_CANCELLED), anyString());
    }

    @Test
    @DisplayName("Other event types are acknowledged and ignored")
    void otherEventsIgnored() {
        listener.onTradeEvent(record("ev-4", "ORDER_PLACED", PAYLOAD), ack);

        verifyNoInteractions(recorder);
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("An event with no usable id or account is acknowledged, not retried forever")
    void malformedEventsAcknowledged() {
        listener.onTradeEvent(record(null, "ORDER_FILLED", PAYLOAD), ack);
        listener.onTradeEvent(record("ev-5", "ORDER_FILLED", "{\"symbol\":\"TCS\"}"), ack);
        listener.onTradeEvent(record("x".repeat(65), "ORDER_FILLED", PAYLOAD), ack);

        verify(recorder, never()).record(anyString(), anyLong(), any(), anyString());
        verify(ack, org.mockito.Mockito.times(3)).acknowledge();
    }

    @Test
    @DisplayName("An event for an account that does not exist is acknowledged without a row")
    void unknownAccount() {
        given(recorder.accountExists(7L)).willReturn(false);

        listener.onTradeEvent(record("ev-6", "ORDER_FILLED", PAYLOAD), ack);

        verify(recorder, never()).record(anyString(), anyLong(), any(), anyString());
        verify(ack).acknowledge();
    }

    @Test
    @DisplayName("A database failure leaves the offset uncommitted: the record is sent back for redelivery")
    void databaseFailureIsNotAcknowledged() {
        given(recorder.accountExists(7L)).willReturn(true);
        given(recorder.record(anyString(), anyLong(), any(), anyString()))
                .willThrow(new DataAccessResourceFailureException("db down"));

        listener.onTradeEvent(record("ev-7", "ORDER_FILLED", PAYLOAD), ack);

        verify(ack, never()).acknowledge();
        verify(ack).nack(any(Duration.class));
    }
}
