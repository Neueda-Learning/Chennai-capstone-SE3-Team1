package com.team1.trading.api.controller;

import com.team1.trading.api.dto.CandleResponse;
import com.team1.trading.api.dto.MarketPoint;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.market.CandleService;
import com.team1.trading.api.security.JwtVerificationFilter;
import com.team1.trading.api.service.MarketService;
import com.team1.trading.domain.exception.InstrumentNotFoundException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = MarketController.class,
        excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = JwtVerificationFilter.class))
@TestPropertySource(properties = {
        "jwt.secret=test-secret-key",
        "jwt.issuer=auth-service",
        "spring.datasource.url=jdbc:h2:mem:markettestdb;DB_CLOSE_DELAY=-1"
})
class MarketControllerWebTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private MarketService marketService;

    @MockitoBean
    private CandleService candleService;

    @Test
    @DisplayName("GET /quotes lists the latest quote per instrument")
    void quotes() throws Exception {
        MarketQuoteResponse quote = new MarketQuoteResponse();
        quote.setSymbol("RELIANCE");
        quote.setName("Reliance Industries");
        quote.setPrice(new BigDecimal("1300.10"));
        MarketQuoteResponse unpriced = new MarketQuoteResponse();
        unpriced.setSymbol("ITC");
        given(marketService.latestQuotes()).willReturn(List.of(quote, unpriced));

        mockMvc.perform(get("/api/v1/market/quotes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].symbol", is("RELIANCE")))
                .andExpect(jsonPath("$[0].price", is(1300.10)))
                .andExpect(jsonPath("$[1].price").doesNotExist());
    }

    @Test
    @DisplayName("GET /quotes/{symbol}/history returns the points oldest first")
    void history() throws Exception {
        given(marketService.history("RELIANCE", 50)).willReturn(List.of(
                new MarketPoint(OffsetDateTime.parse("2026-09-28T09:15:00Z"), new BigDecimal("1300.10"))));

        mockMvc.perform(get("/api/v1/market/quotes/RELIANCE/history").param("limit", "50"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].price", is(1300.10)));
    }

    @Test
    @DisplayName("An unknown symbol is INS-404")
    void unknownSymbol() throws Exception {
        given(marketService.history("NOPE", null)).willThrow(new InstrumentNotFoundException("NOPE"));

        mockMvc.perform(get("/api/v1/market/quotes/NOPE/history"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.errorCode", is("INS-404")));
    }

    @Test
    @DisplayName("GET /candles passes the interval and range through and returns OHLC")
    void candles() throws Exception {
        CandleResponse c = new CandleResponse();
        c.setTime(OffsetDateTime.parse("2026-10-03T10:00:00+05:30"));
        c.setOpen(new BigDecimal("1300.00"));
        c.setHigh(new BigDecimal("1305.50"));
        c.setLow(new BigDecimal("1299.00"));
        c.setClose(new BigDecimal("1304.25"));
        given(candleService.candles("RELIANCE", "15m", "1d")).willReturn(List.of(c));

        mockMvc.perform(get("/api/v1/market/quotes/RELIANCE/candles").param("interval", "15m").param("range", "1d"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].open", is(1300.00)))
                .andExpect(jsonPath("$[0].high", is(1305.50)))
                .andExpect(jsonPath("$[0].low", is(1299.00)))
                .andExpect(jsonPath("$[0].close", is(1304.25)));
    }

    @Test
    @DisplayName("GET /candles defaults to 5-minute candles over a day")
    void candlesDefaults() throws Exception {
        given(candleService.candles("RELIANCE", "5m", "1d")).willReturn(List.of());

        mockMvc.perform(get("/api/v1/market/quotes/RELIANCE/candles")).andExpect(status().isOk());
    }

    @Test
    @DisplayName("A nonsense interval is VAL-422")
    void candlesInvalid() throws Exception {
        given(candleService.candles("RELIANCE", "7m", "1d")).willThrow(new com.team1.trading.domain.exception.InvalidOrderException("interval/range", "7m/1d"));

        mockMvc.perform(get("/api/v1/market/quotes/RELIANCE/candles").param("interval", "7m"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errorCode", is("VAL-422")));
    }
}
