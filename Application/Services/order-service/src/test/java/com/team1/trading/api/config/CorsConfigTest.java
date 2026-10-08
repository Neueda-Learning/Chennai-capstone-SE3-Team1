package com.team1.trading.api.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import com.team1.trading.api.security.TestJwtBuilder;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "jwt.secret=" + TestJwtBuilder.TEST_SECRET,
        "jwt.issuer=" + TestJwtBuilder.TEST_ISSUER,
        "spring.datasource.url=jdbc:h2:mem:corsconfig;DB_CLOSE_DELAY=-1"
})
@DisplayName("CORS preflight handling")
class CorsConfigTest {

    /** The UI's origin from Application/Config/services.env (FRONTEND_HOST, FRONTEND_PORT). */
    @org.springframework.beans.factory.annotation.Value("http://${FRONTEND_HOST}:${FRONTEND_PORT}")
    private String allowedOrigin;

    @Autowired
    private MockMvc mockMvc;

    @Nested
    @DisplayName("Answers a preflight without demanding a token")
    class Preflight {

        @Test
        void preflight_is_not_rejected_as_unauthorized() throws Exception {
            mockMvc.perform(options("/api/v1/accounts/1/balance")
                            .header("Origin", allowedOrigin)
                            .header("Access-Control-Request-Method", "GET")
                            .header("Access-Control-Request-Headers", "authorization"))
                    .andExpect(status().is2xxSuccessful());
        }

        @Test
        void preflight_advertises_the_requesting_origin() throws Exception {
            mockMvc.perform(options("/api/v1/accounts/1/balance")
                            .header("Origin", allowedOrigin)
                            .header("Access-Control-Request-Method", "GET"))
                    .andExpect(header().string("Access-Control-Allow-Origin", allowedOrigin));
        }

        @Test
        void preflight_advertises_the_methods_the_api_exposes() throws Exception {
            String allowed = mockMvc.perform(options("/api/v1/accounts/1/balance")
                            .header("Origin", allowedOrigin)
                            .header("Access-Control-Request-Method", "GET"))
                    .andReturn().getResponse().getHeader("Access-Control-Allow-Methods");

            org.junit.jupiter.api.Assertions.assertNotNull(allowed);
            for (String method : new String[]{"GET", "POST", "DELETE", "OPTIONS"}) {
                org.junit.jupiter.api.Assertions.assertTrue(
                        allowed.contains(method), "preflight did not advertise " + method + ": " + allowed);
            }
        }

        @Test
        void preflight_advertises_authorization_as_an_allowed_header() throws Exception {
            String allowed = mockMvc.perform(options("/api/v1/accounts/1/balance")
                            .header("Origin", allowedOrigin)
                            .header("Access-Control-Request-Method", "GET")
                            .header("Access-Control-Request-Headers", "authorization"))
                    .andReturn().getResponse().getHeader("Access-Control-Allow-Headers");

            org.junit.jupiter.api.Assertions.assertNotNull(allowed);
            org.junit.jupiter.api.Assertions.assertTrue(
                    allowed.toLowerCase().contains("authorization"),
                    "preflight did not advertise the authorization header: " + allowed);
        }
    }

    @Nested
    @DisplayName("Adds the origin header to real responses")
    class ActualRequests {

        @Test
        void a_valid_get_carries_the_allow_origin_header() throws Exception {
            mockMvc.perform(get("/api/v1/accounts/1/balance")
                            .header("Origin", allowedOrigin)
                            .header("Authorization", TestJwtBuilder.forAccount(1L)
                                    .withSub("user-123").withRoles("CUSTOMER").buildWithTestSecret()))
                    .andExpect(header().string("Access-Control-Allow-Origin", allowedOrigin));
        }

        @Test
        void an_unauthorised_get_still_carries_the_allow_origin_header() throws Exception {
            mockMvc.perform(get("/api/v1/accounts/1/balance").header("Origin", allowedOrigin))
                    .andExpect(status().isUnauthorized())
                    .andExpect(header().string("Access-Control-Allow-Origin", allowedOrigin));
        }
    }

    @Nested
    @DisplayName("Refuses origins it does not trust")
    class UntrustedOrigins {

        @Test
        void a_foreign_origin_gets_no_allow_origin_header() throws Exception {
            mockMvc.perform(get("/api/v1/accounts/1/balance")
                            .header("Origin", "http://evil.example.com")
                            .header("Authorization", TestJwtBuilder.forAccount(1L).buildWithTestSecret()))
                    .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        }

        @Test
        void a_foreign_origin_preflight_gets_no_allow_origin_header() throws Exception {
            mockMvc.perform(options("/api/v1/accounts/1/balance")
                            .header("Origin", "http://evil.example.com")
                            .header("Access-Control-Request-Method", "GET"))
                    .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        }
    }
}
