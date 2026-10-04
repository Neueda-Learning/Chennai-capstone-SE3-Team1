package com.team1.trading.api.config;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

/**
 * Answers CORS preflights for the browser client.
 *
 * <p>The API verifies JWTs with {@code JwtVerificationFilter} rather than Spring Security
 * (see the story requirement noted in the POM), so there is no {@code SecurityFilterChain}
 * and {@code http.cors(...)} is not available. This registers Spring's {@link CorsFilter}
 * as a plain servlet filter instead.
 *
 * <p>Order matters. {@code JwtVerificationFilter} is a {@code @Component}, so Spring Boot
 * auto-registers it, and a preflight never carries an {@code Authorization} header - the
 * filter would answer the browser's question with AUTH-401 before CORS could reply. Running
 * this filter at the highest precedence lets it answer the preflight and short-circuit the
 * chain, so no token check ever runs on an OPTIONS request.
 *
 * <p>Origins are matched as patterns rather than literals so any localhost port is accepted:
 * the Angular dev server's port is not fixed, and the contract does not pin it.
 */
@Configuration
public class CorsConfig {

    /** Browser-facing methods the API exposes. */
    private static final List<String> ALLOWED_METHODS = List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS");

    /** The Authorization header is what makes every call a preflighted one. */
    private static final List<String> ALLOWED_HEADERS = List.of(
            "Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With");

    @Bean
    public FilterRegistrationBean<CorsFilter> corsFilterRegistration() {
        CorsConfiguration config = new CorsConfiguration();
        // Patterns, not origins: allowedOrigins("*") is illegal alongside credentials,
        // and a literal origin list would break the moment the dev server moves port.
        config.setAllowedOriginPatterns(List.of("http://localhost:*", "http://127.0.0.1:*"));
        config.setAllowedMethods(ALLOWED_METHODS);
        config.setAllowedHeaders(ALLOWED_HEADERS);
        // The client authenticates with a bearer token, not a cookie, so there is no
        // ambient credential for a cross-origin caller to leak.
        config.setAllowCredentials(false);
        // Let the browser cache the preflight, so it asks once per origin rather than
        // before every single call.
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);

        FilterRegistrationBean<CorsFilter> registration = new FilterRegistrationBean<>(new CorsFilter(source));
        registration.addUrlPatterns("/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }
}
