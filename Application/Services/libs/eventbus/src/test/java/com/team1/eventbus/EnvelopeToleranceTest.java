package com.team1.eventbus;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class EnvelopeToleranceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void unknownFieldsAreIgnored() throws Exception {
        String json = """
                {
                  "eventId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                  "eventType": "ORDER_PLACED",
                  "eventTime": "2026-09-28T09:14:22Z",
                  "source": "trade-api",
                  "schemaVersion": 1,
                  "payload": { "orderId": "6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e" },
                  "futureField": "must not break",
                  "addedByExtension": 42
                }
                """;

        Envelope envelope = objectMapper.readValue(json, Envelope.class);

        assertEquals("a1b2c3d4-e5f6-7890-abcd-ef1234567890", envelope.eventId());
        assertEquals("ORDER_PLACED", envelope.eventType());
        assertEquals("2026-09-28T09:14:22Z", envelope.eventTime());
        assertEquals("trade-api", envelope.source());
        assertEquals(1, envelope.schemaVersion());
        assertNotNull(envelope.payload());
        assertEquals("6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e",
                     envelope.payload().get("orderId").asText());
    }

    @Test
    void minimalEnvelopeAccepted() throws Exception {
        String json = """
                {
                  "eventId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
                  "eventType": "QUOTE",
                  "eventTime": "2026-09-28T09:15:00Z",
                  "source": "market-poller",
                  "schemaVersion": 1
                }
                """;

        Envelope envelope = objectMapper.readValue(json, Envelope.class);

        assertEquals("b2c3d4e5-f6a7-8901-bcde-f12345678901", envelope.eventId());
        assertEquals("QUOTE", envelope.eventType());
        assertEquals("market-poller", envelope.source());
        assertEquals(1, envelope.schemaVersion());
        assertNull(envelope.payload());
    }

    @Test
    void envelopeWithExtraPayloadFieldsAccepted() throws Exception {
        String json = """
                {
                  "eventId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
                  "eventType": "ORDER_FILLED",
                  "eventTime": "2026-09-28T09:14:24Z",
                  "source": "trade-executor",
                  "schemaVersion": 1,
                  "payload": {
                    "orderId": "6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e",
                    "status": "FILLED",
                    "futurePayloadField": "safe"
                  }
                }
                """;

        Envelope envelope = objectMapper.readValue(json, Envelope.class);

        assertEquals("c3d4e5f6-a7b8-9012-cdef-123456789012", envelope.eventId());
        assertEquals("ORDER_FILLED", envelope.eventType());
        assertNotNull(envelope.payload());
        assertEquals("FILLED", envelope.payload().get("status").asText());
    }
}