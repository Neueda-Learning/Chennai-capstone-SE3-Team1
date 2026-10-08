package com.team1.trading.api.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.ArrayList;
import java.util.List;

@Configuration
public class CorsConfig {

    private static final List<String> ALLOWED_METHODS = List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS");

    private static final List<String> ALLOWED_HEADERS = List.of(
            "Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With");

    /**
     * The browser origin the UI is served from: FRONTEND_HOST and FRONTEND_PORT in
     * Application/Config/services.env. When the UI is on localhost, the loopback address with the same
     * port is the same page, so it is allowed too.
     */
    static List<String> allowedOrigins(String frontendHost, int frontendPort) {
        List<String> origins = new ArrayList<>();
        origins.add("http://" + frontendHost + ":" + frontendPort);
        if ("localhost".equals(frontendHost)) {
            origins.add("http://127.0.0.1:" + frontendPort);
        }
        return origins;
    }

    @Bean
    public FilterRegistrationBean<CorsFilter> corsFilterRegistration(
            @Value("${FRONTEND_HOST}") String frontendHost,
            @Value("${FRONTEND_PORT}") int frontendPort) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(allowedOrigins(frontendHost, frontendPort));
        config.setAllowedMethods(ALLOWED_METHODS);
        config.setAllowedHeaders(ALLOWED_HEADERS);
        config.setAllowCredentials(false);
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);

        FilterRegistrationBean<CorsFilter> registration = new FilterRegistrationBean<>(new CorsFilter(source));
        registration.addUrlPatterns("/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }
}
