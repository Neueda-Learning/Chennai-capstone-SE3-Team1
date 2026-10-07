package com.team1.trading.api.advice;

import com.team1.trading.api.advice.AdviceViews.Advice;
import com.team1.trading.api.advice.AdviceViews.Ideas;
import com.team1.trading.api.advice.AdviceViews.Signal;
import com.team1.trading.api.security.AccessGuard;
import com.team1.trading.api.security.JwtClaims;
import com.team1.trading.api.security.JwtRequestContext;
import com.team1.trading.api.security.JwtVerificationFilter;
import com.team1.trading.domain.exception.InstrumentNotFoundException;
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

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = AdviceController.class,
        excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = JwtVerificationFilter.class))
@Import(AccessGuard.class)
@TestPropertySource(properties = {
        "jwt.secret=test-secret-key",
        "jwt.issuer=auth-service",
        "spring.datasource.url=jdbc:h2:mem:adviceweb;DB_CLOSE_DELAY=-1"
})
class AdviceControllerWebTest {

    private static final LocalDate AS_OF = LocalDate.of(2026, 10, 6);

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AdviceService service;

    @AfterEach
    void clearContext() {
        JwtRequestContext.clear();
    }

    private static void signedInAs(Long accountId, String... roles) {
        JwtRequestContext.setClaims(new JwtClaims("user-" + accountId, accountId, List.of(roles),
                Instant.now(), Instant.now().plusSeconds(900), "auth-service"));
    }

    private static Signal buy() {
        return new Signal("TCS", "Tata Consultancy Services", List.of(SignalSource.HOLDING), 10,
                new BigDecimal("3000"), "OK", "BUY", "HIGH", new BigDecimal("70"), "BUY (high confidence, score +70)",
                List.of("Uptrend: the 20-day average (110.00) is above the 50-day (104.00)."),
                new AdviceViews.Indicators(new BigDecimal("112"), new BigDecimal("110"), new BigDecimal("104"),
                        new BigDecimal("62"), new BigDecimal("4.2"), new BigDecimal("21"), new BigDecimal("-8"), "UP"),
                AS_OF, false,
                new AdviceViews.Prediction(AS_OF.plusDays(1), AS_OF, new BigDecimal("112"), new BigDecimal("112.4"),
                        new BigDecimal("110"), new BigDecimal("114"), new BigDecimal("108"), new BigDecimal("116"),
                        new BigDecimal("0.53"), new BigDecimal("0.36")));
    }

    private static Signal insufficient() {
        return new Signal("INFY", "Infosys", List.of(SignalSource.WATCHLIST), null, null, "INSUFFICIENT_DATA", null,
                null, null, "No analysis has been published for INFY yet.", List.of(), null, null, true, null);
    }

    @Test
    @DisplayName("GET advice answers signals with suggestion, reasons and prediction, and the market's ideas")
    void ownAdvice() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.forAccount(1L)).willReturn(new Advice(1L, "m1", "rules", "Information, not advice",
                LocalDateTime.of(2026, 10, 6, 18, 0), AS_OF, false, List.of(buy(), insufficient()),
                new Ideas(List.of(buy()), List.of())));

        mockMvc.perform(get("/api/v1/accounts/1/advice"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.disclaimer", is("Information, not advice")))
                .andExpect(jsonPath("$.dataAsOf", is("2026-10-06")))
                .andExpect(jsonPath("$.signals", hasSize(2)))
                .andExpect(jsonPath("$.signals[0].suggestion", is("BUY")))
                .andExpect(jsonPath("$.signals[0].reasons[0]", is(buy().reasons().get(0))))
                .andExpect(jsonPath("$.signals[0].prediction.forDate", is("2026-10-07")))
                .andExpect(jsonPath("$.signals[1].status", is("INSUFFICIENT_DATA")))
                .andExpect(jsonPath("$.signals[1].suggestion", nullValue()))
                .andExpect(jsonPath("$.ideas.buy[0].symbol", is("TCS")));
    }

    @Test
    @DisplayName("GET advice for one symbol; an unknown one is INS-404")
    void oneSymbol() throws Exception {
        signedInAs(1L, "CUSTOMER");
        given(service.forSymbol(1L, "TCS")).willReturn(buy());
        given(service.forSymbol(1L, "NOPE")).willThrow(new InstrumentNotFoundException("NOPE"));

        mockMvc.perform(get("/api/v1/accounts/1/advice/TCS"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.symbol", is("TCS")));
        mockMvc.perform(get("/api/v1/accounts/1/advice/NOPE"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.errorCode", is("INS-404")));
    }

    @Test
    @DisplayName("Another customer's account is ACC-403 on both routes and the service is never reached")
    void unauthorisedAccessRejected() throws Exception {
        signedInAs(2L, "CUSTOMER");

        mockMvc.perform(get("/api/v1/accounts/1/advice"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode", is("ACC-403")));
        mockMvc.perform(get("/api/v1/accounts/1/advice/TCS"))
                .andExpect(status().isForbidden());

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("An ADMIN token for another account gets no bypass, and no token is AUTH-401")
    void adminAndNoToken() throws Exception {
        signedInAs(9L, "ADMIN");
        mockMvc.perform(get("/api/v1/accounts/1/advice")).andExpect(status().isForbidden());
        JwtRequestContext.clear();
        mockMvc.perform(get("/api/v1/accounts/1/advice")).andExpect(status().isUnauthorized());
        verifyNoInteractions(service);
    }
}
