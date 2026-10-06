package com.team1.trading.api.watchlists;

import com.team1.trading.api.notifications.Direction;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = AlertController.class,
        excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = JwtVerificationFilter.class))
@Import(AccessGuard.class)
@TestPropertySource(properties = {
        "jwt.secret=test-secret-key",
        "jwt.issuer=auth-service",
        "spring.datasource.url=jdbc:h2:mem:alertsweb;DB_CLOSE_DELAY=-1"
})
class AlertControllerWebTest {

    private static final String ALERT_ID = "0b9c7a2e-5f0e-4a54-9d51-3b1f5b7a9c01";
    private static final String BASE = "/api/v1/accounts/1/alerts";
    private static final String CREATE = "{\"symbol\":\"TCS\",\"threshold\":3500.50,\"direction\":\"ABOVE\"}";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AlertService service;

    @AfterEach
    void clearContext() {
        JwtRequestContext.clear();
    }

    private static void signedInAs(Long accountId, String... roles) {
        JwtRequestContext.setClaims(new JwtClaims("user-" + accountId, accountId, List.of(roles),
                Instant.now(), Instant.now().plusSeconds(900), "auth-service"));
    }

    private static AlertResponse alert(AlertState state, AlertDeliveryState delivery) {
        OffsetDateTime at = OffsetDateTime.of(2026, 10, 6, 9, 15, 0, 0, ZoneOffset.UTC);
        boolean fired = state == AlertState.FIRED;
        return new AlertResponse(ALERT_ID, "TCS", new BigDecimal("3500.5000"), Direction.ABOVE, state, delivery,
                fired ? at : null, fired ? new BigDecimal("3501.0000") : null, at);
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder builder, String body) {
        return builder.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    @Test
    @DisplayName("GET returns the customer's alerts with their state and delivery state")
    void listOwn() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.list(1L)).willReturn(List.of(alert(AlertState.FIRED, AlertDeliveryState.QUEUED),
                alert(AlertState.ARMED, null)));

        mockMvc.perform(get(BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].state", is("FIRED")))
                .andExpect(jsonPath("$[0].deliveryState", is("QUEUED")))
                .andExpect(jsonPath("$[0].firedPrice", is(3501.0)))
                .andExpect(jsonPath("$[1].state", is("ARMED")))
                .andExpect(jsonPath("$[1].deliveryState", nullValue()));
    }

    @Test
    @DisplayName("POST creates an ARMED alert on the token's account and answers 201")
    void createOwn() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.create(anyLong(), any())).willReturn(alert(AlertState.ARMED, null));

        mockMvc.perform(json(post(BASE), CREATE))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.state", is("ARMED")))
                .andExpect(jsonPath("$.direction", is("ABOVE")));

        verify(service).create(1L, new CreateAlertRequest("TCS", new BigDecimal("3500.50"), Direction.ABOVE));
    }

    @Test
    @DisplayName("Every alert route on another customer's account is ACC-403 and the service is never called")
    void everyRouteRefusesAnotherAccount() throws Exception {
        signedInAs(1L, "CUSTOMER");
        String other = "/api/v1/accounts/2/alerts";

        mockMvc.perform(get(other)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
        mockMvc.perform(json(post(other), CREATE)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
        mockMvc.perform(json(patch(other + "/" + ALERT_ID), "{\"state\":\"ARMED\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
        mockMvc.perform(delete(other + "/" + ALERT_ID)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("An ADMIN token gets no bypass and no token is AUTH-401")
    void noBypassAndNoToken() throws Exception {
        signedInAs(9L, "ADMIN");
        mockMvc.perform(get(BASE)).andExpect(status().isForbidden());
        JwtRequestContext.clear();
        mockMvc.perform(get(BASE)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode", is("AUTH-401")));

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("The twenty-sixth alert is 429 WLT-429 and an unknown symbol is 422 WLT-422")
    void capAndUnknownSymbol() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.create(anyLong(), any()))
                .willThrow(new WatchlistLimitException("An account can hold at most 25 price alerts"))
                .willThrow(new WatchlistInvalidException("Unknown instrument"));

        mockMvc.perform(json(post(BASE), CREATE)).andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.errorCode", is("WLT-429")));
        mockMvc.perform(json(post(BASE), CREATE)).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("WLT-422")));
    }

    @Test
    @DisplayName("A zero or negative threshold, too many decimals, a bad direction, an unknown property are VAL-422")
    void malformedCreate() throws Exception {
        signedInAs(1L, "CUSTOMER");

        for (String body : List.of(
                "{\"symbol\":\"TCS\",\"threshold\":0,\"direction\":\"ABOVE\"}",
                "{\"symbol\":\"TCS\",\"threshold\":-5,\"direction\":\"ABOVE\"}",
                "{\"symbol\":\"TCS\",\"threshold\":1.23456,\"direction\":\"ABOVE\"}",
                "{\"symbol\":\"TCS\",\"threshold\":100000000000000.5,\"direction\":\"ABOVE\"}",
                "{\"symbol\":\"TCS\",\"threshold\":10,\"direction\":\"SIDEWAYS\"}",
                "{\"symbol\":\"TCS\",\"threshold\":10}",
                "{\"threshold\":10,\"direction\":\"ABOVE\"}",
                "{\"symbol\":\"TCS\",\"threshold\":10,\"direction\":\"ABOVE\",\"state\":\"FIRED\"}")) {
            mockMvc.perform(json(post(BASE), body)).andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.errorCode", is("VAL-422")));
        }

        verify(service, never()).create(anyLong(), any());
    }

    @Test
    @DisplayName("PATCH re-arms or disables; FIRED cannot be set by a caller")
    void patchStates() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.update(anyLong(), anyString(), any())).willReturn(alert(AlertState.ARMED, null));

        mockMvc.perform(json(patch(BASE + "/" + ALERT_ID), "{\"state\":\"ARMED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state", is("ARMED")));
        mockMvc.perform(json(patch(BASE + "/" + ALERT_ID), "{\"state\":\"FIRED\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));
        mockMvc.perform(json(patch(BASE + "/" + ALERT_ID), "{}"))
                .andExpect(status().isUnprocessableEntity());

        verify(service).update(1L, ALERT_ID, new UpdateAlertRequest(SettableAlertState.ARMED));
    }

    @Test
    @DisplayName("An alert that is not on this account is WLT-404 on PATCH and DELETE; DELETE answers 204")
    void notFoundAndDelete() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.update(anyLong(), anyString(), any())).willThrow(new WatchlistNotFoundException("Alert"));
        doThrow(new WatchlistNotFoundException("Alert")).when(service).delete(1L, "missing");

        mockMvc.perform(json(patch(BASE + "/" + ALERT_ID), "{\"state\":\"DISABLED\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.errorCode", is("WLT-404")));
        mockMvc.perform(delete(BASE + "/missing")).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.errorCode", is("WLT-404")));
        mockMvc.perform(delete(BASE + "/" + ALERT_ID)).andExpect(status().isNoContent());

        verify(service).delete(1L, ALERT_ID);
    }
}
