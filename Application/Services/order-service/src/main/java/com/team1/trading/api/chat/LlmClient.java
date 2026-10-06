package com.team1.trading.api.chat;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

/**
 * What the chat module needs from a language model, in no provider's vocabulary. GeminiClient is the
 * only implementation today; another provider (or a local model) is a second implementation of this
 * interface and a different bean, with ChatService and the tools untouched.
 */
public interface LlmClient {

    LlmResult generate(String systemPrompt, List<Turn> turns, List<ToolSpec> tools);

    sealed interface Turn {

        record User(String text) implements Turn {
        }

        /**
         * A model turn. {@code raw} is the provider's own representation of the turn, kept so it can be
         * handed back exactly as received (some models require their opaque reasoning markers to be
         * returned with the tool results); null for turns that did not come from the model, such as
         * earlier assistant messages replayed from the browser.
         */
        record Model(String text, List<ToolCall> calls, JsonNode raw) implements Turn {
        }

        record ToolResults(List<ToolResult> results) implements Turn {
        }
    }

    record ToolCall(String id, String name, JsonNode args) {
    }

    record ToolResult(String id, String name, JsonNode content) {
    }

    /** {@code parameters} is a JSON-schema-style object describing the arguments. */
    record ToolSpec(String name, String description, JsonNode parameters) {
    }

    record LlmResult(String text, List<ToolCall> calls, JsonNode raw) {
    }
}
