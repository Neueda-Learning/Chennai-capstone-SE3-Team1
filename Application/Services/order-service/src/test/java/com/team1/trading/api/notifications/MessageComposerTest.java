package com.team1.trading.api.notifications;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class MessageComposerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    @DisplayName("A price alert reads as plain text with the threshold and the observed price")
    void priceAlert() {
        String payload = MessageComposer.alertPayload(new AlertNotification(UUID.randomUUID(), 1L, "TCS",
                new BigDecimal("3500.00"), Direction.BELOW, new BigDecimal("3490.10"), OffsetDateTime.now()));

        assertThat(MessageComposer.message(NotificationKind.PRICE_ALERT, payload))
                .isEqualTo("Price alert: TCS is below 3500.00 (now 3490.10).");
    }

    @Test
    @DisplayName("A trade payload keeps only order facts; credentials and unknown fields are dropped")
    void tradePayloadKeepsOrderFactsOnly() throws Exception {
        String payload = MessageComposer.tradePayload(MAPPER.readTree(
                "{\"symbol\":\"TCS\",\"side\":\"BUY\",\"quantity\":3,\"price\":3500.5,\"cardNumber\":\"4111111111111111\","
                        + "\"token\":\"abc\",\"cashDelta\":-5}"));

        assertThat(payload).contains("\"symbol\":\"TCS\"").contains("\"quantity\":\"3\"")
                .doesNotContain("4111").doesNotContain("token").doesNotContain("cashDelta");
    }

    @Test
    @DisplayName("Control characters in a reason are removed and a long reason is cut")
    void reasonIsCleaned() {
        String reason = "bad\r\nBcc: x" + "y".repeat(500);
        String message = MessageComposer.message(NotificationKind.ORDER_REJECTED,
                "{\"symbol\":\"TCS\",\"reason\":\"" + reason.replace("\r", "\\r").replace("\n", "\\n") + "\"}");

        assertThat(message).doesNotContain("\r").doesNotContain("\n");
        assertThat(message.length()).isLessThan(300);
    }

    @Test
    @DisplayName("A payload that cannot be read still yields a message")
    void unreadablePayload() {
        assertThat(MessageComposer.message(NotificationKind.ORDER_FILLED, "not json"))
                .isEqualTo("A notification was recorded for your account.");
        assertThat(MessageComposer.message(NotificationKind.ORDER_FILLED, null))
                .isEqualTo("A notification was recorded for your account.");
    }
}
