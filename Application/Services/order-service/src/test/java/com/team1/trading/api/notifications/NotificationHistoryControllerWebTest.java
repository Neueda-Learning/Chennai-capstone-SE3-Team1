package com.team1.trading.api.notifications;

import com.team1.trading.api.preferences.ChannelKind;
import com.team1.trading.api.security.AccessGuard;
import com.team1.trading.api.security.JwtClaims;
import com.team1.trading.api.security.JwtRequestContext;
import com.team1.trading.api.security.JwtVerificationFilter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = NotificationHistoryController.class,
        excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = JwtVerificationFilter.class))
@Import(AccessGuard.class)
@TestPropertySource(properties = {
        "jwt.secret=test-secret-key",
        "jwt.issuer=auth-service",
        "spring.datasource.url=jdbc:h2:mem:notificationhistoryweb;DB_CLOSE_DELAY=-1"
})
class NotificationHistoryControllerWebTest {

    private static final String URL = "/api/v1/accounts/1/notification-history";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private NotificationHistoryService service;

    @AfterEach
    void clearContext() {
        JwtRequestContext.clear();
    }

    private static void signedInAs(Long accountId, String... roles) {
        JwtRequestContext.setClaims(new JwtClaims("user-" + accountId, accountId, List.of(roles),
                Instant.now(), Instant.now().plusSeconds(900), "auth-service"));
    }

    private static NotificationHistoryEntry entry(NotificationStatus status, ChannelKind channel) {
        return new NotificationHistoryEntry(UUID.fromString("11111111-2222-3333-4444-555555555555"),
                NotificationKind.ORDER_FILLED, "Your BUY order for 10 TCS was filled at 3501.25.", channel, status,
                OffsetDateTime.parse("2026-10-06T10:00:00Z"), null);
    }

    @Test
    @DisplayName("The customer's own history is returned with channel kind and status, and no address")
    void ownHistory() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.history(eq(1L), any(), any())).willReturn(List.of(
                entry(NotificationStatus.QUEUED, ChannelKind.EMAIL), entry(NotificationStatus.PENDING_CHANNEL, null)));

        mockMvc.perform(get(URL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].kind", is("ORDER_FILLED")))
                .andExpect(jsonPath("$[0].channel", is("EMAIL")))
                .andExpect(jsonPath("$[0].status", is("QUEUED")))
                .andExpect(jsonPath("$[0].deliveredAt", nullValue()))
                .andExpect(jsonPath("$[1].channel", nullValue()))
                .andExpect(jsonPath("$[1].status", is("PENDING_CHANNEL")))
                .andExpect(content().string(not(containsString("address"))))
                .andExpect(content().string(not(containsString("@"))));
    }

    @Test
    @DisplayName("limit and before are passed to the service")
    void paging() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.history(eq(1L), any(), any())).willReturn(List.of());

        mockMvc.perform(get(URL).param("limit", "5").param("before", "2026-10-06T10:00:00Z"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));

        verify(service).history(1L, 5, OffsetDateTime.parse("2026-10-06T10:00:00Z"));
    }

    @Test
    @DisplayName("A limit or cursor that cannot be read is VAL-422")
    void badQuery() throws Exception {
        signedInAs(1L, "CUSTOMER");

        mockMvc.perform(get(URL).param("limit", "many"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));
        mockMvc.perform(get(URL).param("before", "yesterday"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("Another customer's history is ACC-403 and the service is never called")
    void otherAccountRefused() throws Exception {
        signedInAs(2L, "CUSTOMER");

        mockMvc.perform(get(URL))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("An ADMIN token gets no bypass")
    void adminHasNoBypass() throws Exception {
        signedInAs(9L, "ADMIN");

        mockMvc.perform(get(URL))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("No verified token is AUTH-401")
    void noToken() throws Exception {
        mockMvc.perform(get(URL))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode", is("AUTH-401")));

        verifyNoInteractions(service);
    }
}
