package com.team1.trading.api.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Google Gemini over its REST API. The free tier is rate-limited and its newer models are sometimes
 * overloaded, so a request walks down the configured model list (chat.models) until one answers, and
 * retries the first model once on a 503 before moving on.
 *
 * The API key is sent in a header, never in the URL, and neither the key nor any prompt text is logged.
 */
@Component
public class GeminiClient implements LlmClient {

    private static final Logger log = LoggerFactory.getLogger(GeminiClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_OUTPUT_TOKENS = 1500;
    private static final double TEMPERATURE = 0.3;
    private static final long RETRY_PAUSE_MS = 700;

    private final GeminiSettings settings;
    private final RestClient http;

    public GeminiClient(ObjectProvider<GeminiSettings> settings) {
        this.settings = settings.getIfAvailable();
        if (this.settings == null) {
            this.http = null;
            log.warn("[chat] LLM_API_KEY is not in the vault; the assistant is switched off");
        } else {
            SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
            factory.setConnectTimeout(Duration.ofSeconds(10));
            factory.setReadTimeout(Duration.ofSeconds(this.settings.timeoutSeconds()));
            this.http = RestClient.builder()
                    .baseUrl(this.settings.baseUrl())
                    .requestFactory(factory)
                    .defaultHeader("x-goog-api-key", this.settings.apiKey())
                    .build();
        }
    }

    @Override
    public LlmResult generate(String systemPrompt, List<Turn> turns, List<ToolSpec> tools) {
        if (http == null) {
            throw ChatException.unavailable();
        }
        ObjectNode body = requestBody(systemPrompt, turns, tools, settings.thinkingLevel());

        for (String model : settings.models()) {
            int attempt = 0;
            while (attempt < 2) {
                attempt++;
                try {
                    JsonNode reply = http.post()
                            .uri("/models/{model}:generateContent", model)
                            .contentType(MediaType.APPLICATION_JSON)
                            .body(body)
                            .retrieve()
                            .body(JsonNode.class);
                    return parse(reply);
                } catch (RestClientResponseException e) {
                    int status = e.getStatusCode().value();
                    if (status == 401 || status == 403) {
                        log.error("[chat] the model API rejected the key (HTTP {})", status);
                        throw ChatException.unavailable();
                    }
                    log.warn("[chat] model {} answered HTTP {} (attempt {})", model, status, attempt);
                    if (status == 400 && dropThinking(body)) {
                        attempt--; // this model may not accept a thinking setting: ask again without it
                        continue;
                    }
                    if (status == 503 && attempt == 1 && model.equals(settings.models().get(0))) {
                        pause();
                        continue;
                    }
                    break; // try the next model
                } catch (RuntimeException e) {
                    log.warn("[chat] model {} could not be reached: {}", model, e.getClass().getSimpleName());
                    break;
                }
            }
        }
        throw ChatException.unavailable();
    }

    /** Removes the thinking setting from the request; false if there was none to remove. */
    private static boolean dropThinking(ObjectNode body) {
        JsonNode generation = body.get("generationConfig");
        return generation instanceof ObjectNode config && config.remove("thinkingConfig") != null;
    }

    static ObjectNode requestBody(String systemPrompt, List<Turn> turns, List<ToolSpec> tools, String thinkingLevel) {
        ObjectNode body = JSON.createObjectNode();
        body.putObject("systemInstruction").putArray("parts").addObject().put("text", systemPrompt);

        ArrayNode contents = body.putArray("contents");
        for (Turn turn : turns) {
            if (turn instanceof Turn.User user) {
                ObjectNode content = contents.addObject().put("role", "user");
                content.putArray("parts").addObject().put("text", user.text());
            } else if (turn instanceof Turn.Model model) {
                ObjectNode content = contents.addObject().put("role", "model");
                content.set("parts", modelParts(model));
            } else if (turn instanceof Turn.ToolResults results) {
                ObjectNode content = contents.addObject().put("role", "user");
                ArrayNode parts = content.putArray("parts");
                for (ToolResult result : results.results()) {
                    ObjectNode response = parts.addObject().putObject("functionResponse");
                    if (result.id() != null) {
                        response.put("id", result.id());
                    }
                    response.put("name", result.name());
                    JsonNode value = result.content();
                    if (value != null && value.isObject()) {
                        response.set("response", value);
                    } else {
                        response.putObject("response").set("result", value);
                    }
                }
            }
        }

        if (!tools.isEmpty()) {
            ArrayNode declarations = body.putArray("tools").addObject().putArray("functionDeclarations");
            for (ToolSpec tool : tools) {
                ObjectNode declaration = declarations.addObject();
                declaration.put("name", tool.name());
                declaration.put("description", tool.description());
                if (tool.parameters() != null && tool.parameters().path("properties").size() > 0) {
                    declaration.set("parameters", tool.parameters()); // the API rejects an empty OBJECT schema
                }
            }
        }

        ObjectNode generation = body.putObject("generationConfig");
        generation.put("temperature", TEMPERATURE);
        generation.put("maxOutputTokens", MAX_OUTPUT_TOKENS);
        if (thinkingLevel != null && !thinkingLevel.isBlank()) {
            generation.putObject("thinkingConfig").put("thinkingLevel", thinkingLevel);
        }
        return body;
    }

    private static JsonNode modelParts(Turn.Model model) {
        if (model.raw() != null && model.raw().isArray()) {
            return model.raw(); // hand back exactly what the model produced
        }
        ArrayNode parts = JSON.createArrayNode();
        if (model.text() != null && !model.text().isBlank()) {
            parts.addObject().put("text", model.text());
        }
        if (model.calls() != null) {
            for (ToolCall call : model.calls()) {
                ObjectNode functionCall = parts.addObject().putObject("functionCall");
                functionCall.put("name", call.name());
                functionCall.set("args", call.args());
            }
        }
        if (parts.isEmpty()) {
            parts.addObject().put("text", "");
        }
        return parts;
    }

    static LlmResult parse(JsonNode reply) {
        JsonNode parts = reply == null ? null : reply.path("candidates").path(0).path("content").path("parts");
        if (parts == null || !parts.isArray()) {
            return new LlmResult("", List.of(), null);
        }
        StringBuilder text = new StringBuilder();
        List<ToolCall> calls = new ArrayList<>();
        for (JsonNode part : parts) {
            if (part.path("thought").asBoolean(false)) {
                continue; // reasoning summaries are not for the user
            }
            if (part.hasNonNull("text")) {
                text.append(part.get("text").asText());
            }
            JsonNode call = part.get("functionCall");
            if (call != null && call.hasNonNull("name")) {
                String id = call.hasNonNull("id") ? call.get("id").asText() : UUID.randomUUID().toString();
                calls.add(new ToolCall(id, call.get("name").asText(), call.has("args") ? call.get("args") : JSON.createObjectNode()));
            }
        }
        return new LlmResult(text.toString(), calls, parts);
    }

    private static void pause() {
        try {
            Thread.sleep(RETRY_PAUSE_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
