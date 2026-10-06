package com.team1.trading.api.notifications;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessResourceFailureException;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class NotificationDeliveryServiceTest {

    private static final UUID DELIVERY_ID = UUID.fromString("11111111-2222-3333-4444-555555555555");

    @Mock
    private NotificationRecorder recorder;

    private NotificationDeliveryService service;

    @BeforeEach
    void setUp() {
        service = new NotificationDeliveryService(recorder);
    }

    private static AlertNotification alert() {
        return new AlertNotification(DELIVERY_ID, 7L, "TCS", new BigDecimal("3500.00"), Direction.ABOVE,
                new BigDecimal("3512.40"), OffsetDateTime.parse("2026-10-06T10:00:00Z"));
    }

    @Test
    @DisplayName("A resolved channel returns QUEUED and the row is keyed on the delivery id")
    void queued() {
        given(recorder.accountExists(7L)).willReturn(true);
        given(recorder.record(anyString(), anyLong(), any(), anyString()))
                .willReturn(new NotificationRecorder.Recorded(NotificationStatus.QUEUED, true));

        DeliveryOutcome outcome = service.deliver(alert());

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(recorder).record(eq(DELIVERY_ID.toString()), eq(7L), eq(NotificationKind.PRICE_ALERT), payload.capture());
        assertThat(outcome).isEqualTo(DeliveryOutcome.QUEUED);
        assertThat(payload.getValue()).contains("\"symbol\":\"TCS\"").contains("\"direction\":\"ABOVE\"");
    }

    @Test
    @DisplayName("No usable channel returns PENDING_CHANNEL, not an exception")
    void pendingChannel() {
        given(recorder.accountExists(7L)).willReturn(true);
        given(recorder.record(anyString(), anyLong(), any(), anyString()))
                .willReturn(new NotificationRecorder.Recorded(NotificationStatus.PENDING_CHANNEL, true));

        assertThat(service.deliver(alert())).isEqualTo(DeliveryOutcome.PENDING_CHANNEL);
    }

    @Test
    @DisplayName("A replay returns the outcome of the row already written, even after it was sent")
    void replay() {
        given(recorder.accountExists(7L)).willReturn(true);
        given(recorder.record(anyString(), anyLong(), any(), anyString()))
                .willReturn(new NotificationRecorder.Recorded(NotificationStatus.SENT, false));

        assertThat(service.deliver(alert())).isEqualTo(DeliveryOutcome.QUEUED);
    }

    @Test
    @DisplayName("An unknown account is REJECTED and nothing is written")
    void unknownAccount() {
        given(recorder.accountExists(7L)).willReturn(false);

        assertThat(service.deliver(alert())).isEqualTo(DeliveryOutcome.REJECTED);

        verify(recorder, never()).record(anyString(), anyLong(), any(), anyString());
    }

    @Test
    @DisplayName("A missing request is REJECTED")
    void nullRequest() {
        assertThat(service.deliver(null)).isEqualTo(DeliveryOutcome.REJECTED);
    }

    @Test
    @DisplayName("A database failure is NotificationDeliveryException, the only exception the seam raises")
    void infrastructureFailure() {
        given(recorder.accountExists(7L)).willThrow(new DataAccessResourceFailureException("db down"));

        assertThatThrownBy(() -> service.deliver(alert())).isInstanceOf(NotificationDeliveryException.class);
    }

    @Test
    @DisplayName("A malformed alert cannot be constructed at all")
    void malformedAlert() {
        assertThatThrownBy(() -> new AlertNotification(null, 7L, "TCS", BigDecimal.ONE, Direction.ABOVE,
                BigDecimal.ONE, OffsetDateTime.now())).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new AlertNotification(DELIVERY_ID, 7L, " ", BigDecimal.ONE, Direction.ABOVE,
                BigDecimal.ONE, OffsetDateTime.now())).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new AlertNotification(DELIVERY_ID, 7L, "TCS", BigDecimal.ONE, null,
                BigDecimal.ONE, OffsetDateTime.now())).isInstanceOf(IllegalArgumentException.class);
    }
}
