package com.team1.trading.api.preferences;

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
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;

import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = PreferenceController.class,
        excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = JwtVerificationFilter.class))
@Import(AccessGuard.class)
@TestPropertySource(properties = {
        "jwt.secret=test-secret-key",
        "jwt.issuer=auth-service",
        "spring.datasource.url=jdbc:h2:mem:preferencesweb;DB_CLOSE_DELAY=-1"
})
class PreferenceControllerWebTest {

    private static final String BODY = "{\"defaultAccountId\":1,\"channel\":\"PUSH\"}";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PreferenceService service;

    @AfterEach
    void clearContext() {
        JwtRequestContext.clear();
    }

    private static void signedInAs(Long accountId, String... roles) {
        JwtRequestContext.setClaims(new JwtClaims("user-" + accountId, accountId, List.of(roles),
                Instant.now(), Instant.now().plusSeconds(900), "auth-service"));
    }

    private static PreferencesResponse stored() {
        return new PreferencesResponse(1L, 1L, ChannelKind.PUSH, LocalDateTime.of(2026, 10, 6, 10, 15, 30));
    }

    @Test
    @DisplayName("GET on the token's own account returns the stored preference")
    void getOwn() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.get(1L)).willReturn(stored());

        mockMvc.perform(get("/api/v1/accounts/1/preferences"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountId", is(1)))
                .andExpect(jsonPath("$.defaultAccountId", is(1)))
                .andExpect(jsonPath("$.channel", is("PUSH")));
    }

    @Test
    @DisplayName("GET on another customer's account is ACC-403 and the service is never called")
    void getOtherAccountRefused() throws Exception {
        signedInAs(1L, "CUSTOMER");

        mockMvc.perform(get("/api/v1/accounts/2/preferences"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("PUT on another customer's account is ACC-403 and nothing is written")
    void putOtherAccountRefused() throws Exception {
        signedInAs(1L, "CUSTOMER");

        mockMvc.perform(put("/api/v1/accounts/2/preferences")
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));

        verify(service, never()).put(any(), any());
    }

    @Test
    @DisplayName("An ADMIN token gets no bypass on another customer's preferences")
    void adminHasNoBypass() throws Exception {
        signedInAs(9L, "ADMIN");

        mockMvc.perform(get("/api/v1/accounts/1/preferences"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
        mockMvc.perform(put("/api/v1/accounts/1/preferences")
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isForbidden());

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("A token with a null accountId claim reaches nothing")
    void nullAccountClaimRefused() throws Exception {
        signedInAs(null, "CUSTOMER");

        mockMvc.perform(get("/api/v1/accounts/1/preferences"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
    }

    @Test
    @DisplayName("No verified token on the request is AUTH-401")
    void noVerifiedToken() throws Exception {
        mockMvc.perform(get("/api/v1/accounts/1/preferences"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode", is("AUTH-401")));

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("Nothing stored yet is 404 PRF-404")
    void notSetYet() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.get(1L)).willThrow(new PreferencesNotFoundException());

        mockMvc.perform(get("/api/v1/accounts/1/preferences"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.errorCode", is("PRF-404")));
    }

    @Test
    @DisplayName("PUT on the token's own account stores and returns the preference")
    void putOwn() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.put(any(), any())).willReturn(stored());

        mockMvc.perform(put("/api/v1/accounts/1/preferences")
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.channel", is("PUSH")));

        verify(service).put(1L, new PreferencesRequest(1L, ChannelKind.PUSH));
    }

    @Test
    @DisplayName("A default account that is not the customer's own is 422 PRF-422")
    void defaultAccountNotOwn() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.put(any(), any())).willThrow(new PreferencesInvalidException("Default account is not one of your accounts"));

        mockMvc.perform(put("/api/v1/accounts/1/preferences")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"defaultAccountId\":2,\"channel\":\"PUSH\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("PRF-422")));
    }

    @Test
    @DisplayName("A body that carries an email address is VAL-422: this module never accepts a contact detail")
    void contactDetailInBodyRefused() throws Exception {
        signedInAs(1L, "CUSTOMER");

        mockMvc.perform(put("/api/v1/accounts/1/preferences")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"defaultAccountId\":1,\"channel\":\"PUSH\",\"email\":\"x@example.com\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));

        verify(service, never()).put(any(), any());
    }

    @Test
    @DisplayName("An unknown channel (SMS is no longer one) and a missing field are VAL-422")
    void malformedBodies() throws Exception {
        signedInAs(1L, "CUSTOMER");

        mockMvc.perform(put("/api/v1/accounts/1/preferences")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"defaultAccountId\":1,\"channel\":\"SMS\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));
        mockMvc.perform(put("/api/v1/accounts/1/preferences")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"defaultAccountId\":1,\"channel\":\"FAX\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));
        mockMvc.perform(put("/api/v1/accounts/1/preferences")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"channel\":\"PUSH\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));

        verify(service, never()).put(any(), any());
    }
}
