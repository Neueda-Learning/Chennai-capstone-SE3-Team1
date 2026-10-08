package com.team1.trading.api.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("CORS origins are built from the frontend address in the config")
class CorsAllowedOriginsTest {

    @Test
    @DisplayName("A UI on localhost may also be reached by its loopback address, on the same port")
    void localhostAlsoAllowsLoopback() {
        assertThat(CorsConfig.allowedOrigins("localhost", 4200))
                .containsExactly("http://localhost:4200", "http://127.0.0.1:4200");
    }

    @Test
    @DisplayName("Any other UI host is allowed exactly as configured, and nothing else")
    void otherHostsAreAllowedAsConfigured() {
        assertThat(CorsConfig.allowedOrigins("ui.example", 8443)).containsExactly("http://ui.example:8443");
    }
}
