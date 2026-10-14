package com.team1.trading.api.chat;

import org.springframework.core.env.Environment;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

/**
 * Where the model lives and how to reach it. The API key is the TrustMe secret LLM_API_KEY; the rest
 * is plain configuration. thinkingLevel limits how long a model reasons before answering (faster, cheaper;
 * blank leaves the model's default). Absent key means the assistant is switched off (the endpoint answers 503),
 * never that the service fails to start.
 */
public record GeminiSettings(String baseUrl, String apiKey, List<String> models, int timeoutSeconds,
                             String thinkingLevel) {

    static Optional<GeminiSettings> from(Environment env) {
        String key = secret(env, "LLM_API_KEY");
        if (key.isBlank()) {
            return Optional.empty();
        }
        List<String> models = Arrays.stream(env.getProperty("chat.models", "gemini-3.1-flash-lite").split(","))
                .map(String::trim).filter(m -> !m.isEmpty()).toList();
        return Optional.of(new GeminiSettings(
                env.getProperty("chat.base-url", "https://generativelanguage.googleapis.com/v1beta"),
                key.trim(),
                models,
                env.getProperty("chat.timeout-seconds", Integer.class, 30),
                env.getProperty("chat.thinking-level", "low").trim()));
    }

    private static String secret(Environment env, String name) {
        try {
            String value = env.getProperty("trustme.secret." + name);
            return value == null ? "" : value;
        } catch (RuntimeException notInVault) {
            return "";
        }
    }

    @Override
    public String toString() {
        return "GeminiSettings[baseUrl=" + baseUrl + ", apiKey=***, models=" + models + "]";
    }
}
