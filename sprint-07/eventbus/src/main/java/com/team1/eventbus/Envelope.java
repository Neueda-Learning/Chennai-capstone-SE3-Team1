package com.team1.eventbus;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;

@JsonIgnoreProperties(ignoreUnknown = true)
public record Envelope(
        @JsonProperty("eventId")     String eventId,
        @JsonProperty("eventType")   String eventType,
        @JsonProperty("eventTime")   String eventTime,
        @JsonProperty("source")      String source,
        @JsonProperty("schemaVersion") Integer schemaVersion,
        @JsonProperty("payload")     JsonNode payload
) {
}