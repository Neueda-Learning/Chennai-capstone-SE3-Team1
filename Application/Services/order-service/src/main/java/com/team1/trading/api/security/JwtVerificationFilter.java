package com.team1.trading.api.security;

import com.auth0.jwt.exceptions.JWTVerificationException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class JwtVerificationFilter extends OncePerRequestFilter {

    private final JwtValidator jwtValidator;
    private final ObjectMapper objectMapper;

    public JwtVerificationFilter(JwtValidator jwtValidator, ObjectMapper objectMapper) {
        this.jwtValidator = jwtValidator;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        try {
            String authorizationHeader = request.getHeader("Authorization");
            JwtClaims claims = jwtValidator.verify(authorizationHeader);
            
            JwtRequestContext.setClaims(claims);
            
            filterChain.doFilter(request, response);
        } catch (JWTVerificationException e) {
            writeUnauthorizedResponse(response);
        } finally {
            JwtRequestContext.clear();
        }
    }

    private static final List<String> LEGACY_ROUTES = List.of("/api/bank-accounts", "/api/clients");

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }

        String path = request.getRequestURI();
        return !(path.startsWith("/api/v1/") || isLegacyRoute(path));
    }

    private static boolean isLegacyRoute(String path) {
        return LEGACY_ROUTES.stream().anyMatch(prefix -> path.equals(prefix) || path.startsWith(prefix + "/"));
    }

    private void writeUnauthorizedResponse(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        
        Map<String, String> errorBody = new HashMap<>();
        errorBody.put("errorCode", "AUTH-401");
        errorBody.put("message", "Unauthorized");
        
        response.getWriter().write(objectMapper.writeValueAsString(errorBody));
    }
}
