package com.team1.trading.api.chat;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration
public class ChatConfig {

    /** Null when LLM_API_KEY is not in the vault: the chat endpoint then answers 503. */
    @Bean
    GeminiSettings geminiSettings(Environment environment) {
        return GeminiSettings.from(environment).orElse(null);
    }
}
