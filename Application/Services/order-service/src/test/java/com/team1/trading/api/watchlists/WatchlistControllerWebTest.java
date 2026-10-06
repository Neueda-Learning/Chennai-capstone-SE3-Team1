package com.team1.trading.api.watchlists;

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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = WatchlistController.class,
        excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = JwtVerificationFilter.class))
@Import(AccessGuard.class)
@TestPropertySource(properties = {
        "jwt.secret=test-secret-key",
        "jwt.issuer=auth-service",
        "spring.datasource.url=jdbc:h2:mem:watchlistsweb;DB_CLOSE_DELAY=-1"
})
class WatchlistControllerWebTest {

    private static final String LIST_ID = "6f1c1c0e-8c1e-4d3b-9a43-0d4f1f0d2a11";
    private static final String BASE = "/api/v1/accounts/1/watchlists";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private WatchlistService service;

    @AfterEach
    void clearContext() {
        JwtRequestContext.clear();
    }

    private static void signedInAs(Long accountId, String... roles) {
        JwtRequestContext.setClaims(new JwtClaims("user-" + accountId, accountId, List.of(roles),
                Instant.now(), Instant.now().plusSeconds(900), "auth-service"));
    }

    private static WatchlistResponse watchlist() {
        return new WatchlistResponse(LIST_ID, "Banks", OffsetDateTime.of(2026, 10, 6, 9, 15, 0, 0, ZoneOffset.UTC),
                List.of(new WatchlistEntryResponse("HDFCBANK", "HDFC Bank", new BigDecimal("1650.5000"), "INR",
                        new BigDecimal("0.0900"), false, null)));
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder builder, String body) {
        return builder.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    @Test
    @DisplayName("GET on the token's own account returns its watchlists with a live price beside each entry")
    void listOwn() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.list(1L)).willReturn(List.of(watchlist()));

        mockMvc.perform(get(BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].name", is("Banks")))
                .andExpect(jsonPath("$[0].instruments[0].symbol", is("HDFCBANK")))
                .andExpect(jsonPath("$[0].instruments[0].price", is(1650.5)))
                .andExpect(jsonPath("$[0].instruments[0].quoteAsOf", nullValue()));
    }

    @Test
    @DisplayName("POST creates the watchlist for the token's account and answers 201")
    void createOwn() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.create(anyLong(), any())).willReturn(watchlist());

        mockMvc.perform(json(post(BASE), "{\"name\":\"Banks\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", is(LIST_ID)));

        verify(service).create(1L, new CreateWatchlistRequest("Banks"));
    }

    @Test
    @DisplayName("Every watchlist route on another customer's account is ACC-403 and the service is never called")
    void everyRouteRefusesAnotherAccount() throws Exception {
        signedInAs(1L, "CUSTOMER");
        String other = "/api/v1/accounts/2/watchlists";

        mockMvc.perform(get(other)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
        mockMvc.perform(json(post(other), "{\"name\":\"x\"}")).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
        mockMvc.perform(delete(other + "/" + LIST_ID)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
        mockMvc.perform(json(post(other + "/" + LIST_ID + "/instruments"), "{\"symbol\":\"TCS\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
        mockMvc.perform(delete(other + "/" + LIST_ID + "/instruments/TCS")).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("An ADMIN token gets no bypass, and a null accountId claim reaches nothing")
    void noBypass() throws Exception {
        signedInAs(9L, "ADMIN");
        mockMvc.perform(get(BASE)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));

        signedInAs(null, "CUSTOMER");
        mockMvc.perform(get(BASE)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("No verified token is AUTH-401")
    void noToken() throws Exception {
        mockMvc.perform(get(BASE)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode", is("AUTH-401")));
        mockMvc.perform(json(post(BASE), "{\"name\":\"x\"}")).andExpect(status().isUnauthorized());

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("A duplicate name is 409 WLT-409 and the eleventh watchlist is 429 WLT-429")
    void conflictAndCap() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.create(anyLong(), any()))
                .willThrow(new WatchlistConflictException("You already have a watchlist with that name"))
                .willThrow(new WatchlistLimitException("An account can hold at most 10 watchlists"));

        mockMvc.perform(json(post(BASE), "{\"name\":\"Banks\"}")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.errorCode", is("WLT-409")));
        mockMvc.perform(json(post(BASE), "{\"name\":\"More\"}")).andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.errorCode", is("WLT-429")));
    }

    @Test
    @DisplayName("A blank name, an over-long name, an unknown property and a missing body are VAL-422")
    void malformedCreate() throws Exception {
        signedInAs(1L, "CUSTOMER");

        mockMvc.perform(json(post(BASE), "{\"name\":\"  \"}")).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));
        mockMvc.perform(json(post(BASE), "{\"name\":\"" + "x".repeat(61) + "\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));
        mockMvc.perform(json(post(BASE), "{\"name\":\"Banks\",\"accountId\":2}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));
        mockMvc.perform(json(post(BASE), "{}")).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));

        verify(service, never()).create(anyLong(), any());
    }

    @Test
    @DisplayName("Adding an instrument answers 201 with the entry; an unknown symbol is WLT-422")
    void addInstrument() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.addInstrument(anyLong(), anyString(), any()))
                .willReturn(new WatchlistEntryResponse("TCS", "Tata Consultancy Services", null, null, null, false, null))
                .willThrow(new WatchlistInvalidException("Unknown instrument"));

        mockMvc.perform(json(post(BASE + "/" + LIST_ID + "/instruments"), "{\"symbol\":\"tcs\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.symbol", is("TCS")))
                .andExpect(jsonPath("$.price", nullValue()));
        mockMvc.perform(json(post(BASE + "/" + LIST_ID + "/instruments"), "{\"symbol\":\"NOPE\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("WLT-422")));

        verify(service).addInstrument(1L, LIST_ID, new AddInstrumentRequest("tcs"));
    }

    @Test
    @DisplayName("Deleting a watchlist or an entry answers 204; another account's watchlist is WLT-404")
    void deletes() throws Exception {
        signedInAs(1L, "CUSTOMER");

        mockMvc.perform(delete(BASE + "/" + LIST_ID)).andExpect(status().isNoContent());
        mockMvc.perform(delete(BASE + "/" + LIST_ID + "/instruments/TCS")).andExpect(status().isNoContent());

        org.mockito.Mockito.doThrow(new WatchlistNotFoundException("Watchlist"))
                .when(service).delete(1L, "not-a-uuid");
        mockMvc.perform(delete(BASE + "/not-a-uuid")).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.errorCode", is("WLT-404")));

        verify(service).removeInstrument(1L, LIST_ID, "TCS");
    }
}
