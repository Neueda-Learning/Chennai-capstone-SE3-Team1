package com.team1.trading.api.advice;

import com.team1.trading.api.advice.AdviceViews.Advice;
import com.team1.trading.api.advice.AdviceViews.Signal;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.dto.PortfolioResponse;
import com.team1.trading.api.dto.PositionResponse;
import com.team1.trading.api.service.AccountService;
import com.team1.trading.api.service.MarketService;
import com.team1.trading.api.watchlists.WatchedSymbols;
import com.team1.trading.domain.exception.AccountNotActiveException;
import com.team1.trading.domain.exception.InstrumentNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
class AdviceServiceTest {

    private static final LocalDate AS_OF = LocalDate.of(2026, 10, 6);

    @Mock
    private AccountService accounts;
    @Mock
    private WatchedSymbols watched;
    @Mock
    private MarketService market;
    @Mock
    private AnalysisQueries analysis;

    private AdviceService service;

    @BeforeEach
    void setUp() {
        service = new AdviceService(accounts, watched, market, analysis);
        lenient().when(market.latestQuotes()).thenReturn(List.of(quote("TCS"), quote("INFY"), quote("ITC")));
        lenient().when(analysis.unpublished(any(), any())).thenAnswer(inv -> new Signal(inv.getArgument(0),
                inv.getArgument(1), List.of(), null, null, "INSUFFICIENT_DATA", null, null, null,
                "No analysis has been published for " + inv.getArgument(0) + " yet.", List.of(), null, null, true,
                null));
    }

    private static MarketQuoteResponse quote(String symbol) {
        MarketQuoteResponse q = new MarketQuoteResponse();
        q.setSymbol(symbol);
        q.setName(symbol + " Ltd");
        q.setPrice(BigDecimal.TEN);
        return q;
    }

    private static Signal published(String symbol, String suggestion, int score) {
        return new Signal(symbol, symbol + " Ltd", List.of(), null, null, "OK", suggestion, "HIGH",
                BigDecimal.valueOf(score), suggestion + " (high confidence)", List.of("Uptrend: ..."), null, AS_OF,
                false, null);
    }

    private void holds(String symbol) {
        given(accounts.getPortfolio(1L, 1L)).willReturn(new PortfolioResponse(1L,
                List.of(new PositionResponse(1L, symbol, 10, new BigDecimal("3000"), BigDecimal.ZERO)), List.of()));
    }

    @Test
    @DisplayName("Held and watched symbols get the published suggestion with its reasons, plus the market's ideas")
    void signalGeneratedWithReasoning() {
        holds("TCS");
        given(watched.symbolsWatchedBy(1L)).willReturn(List.of("INFY", "TCS"));
        Map<String, Signal> all = new LinkedHashMap<>();
        all.put("TCS", published("TCS", "BUY", 70));
        all.put("ITC", published("ITC", "SELL", -50));
        given(analysis.all()).willReturn(all);
        given(analysis.ranked("BUY", AdviceService.IDEAS)).willReturn(List.of(all.get("TCS")));
        given(analysis.ranked("SELL", AdviceService.IDEAS)).willReturn(List.of(all.get("ITC")));
        given(analysis.isStale(AS_OF)).willReturn(false);

        Advice advice = service.forAccount(1L);

        assertThat(advice.signals()).extracting(Signal::symbol).containsExactly("TCS", "INFY");
        Signal tcs = advice.signals().get(0);
        assertThat(tcs.suggestion()).isEqualTo("BUY");
        assertThat(tcs.reasons()).containsExactly("Uptrend: ...");
        assertThat(tcs.sources()).containsExactly(SignalSource.HOLDING, SignalSource.WATCHLIST);
        assertThat(tcs.heldQuantity()).isEqualTo(10);
        assertThat(advice.ideas().buy()).extracting(Signal::symbol).containsExactly("TCS");
        assertThat(advice.ideas().sell()).extracting(Signal::symbol).containsExactly("ITC");
        assertThat(advice.dataAsOf()).isEqualTo(AS_OF);
        assertThat(advice.disclaimer()).contains("not a personal recommendation");
    }

    @Test
    @DisplayName("A symbol with nothing published is listed with no suggestion and the reason why")
    void noSignalWhenDataInsufficient() {
        holds("TCS");
        given(watched.symbolsWatchedBy(1L)).willReturn(List.of("INFY"));
        given(analysis.all()).willReturn(Map.of("TCS", published("TCS", "BUY", 70)));

        Signal infy = service.forAccount(1L).signals().get(1);

        assertThat(infy.status()).isEqualTo("INSUFFICIENT_DATA");
        assertThat(infy.suggestion()).isNull();
        assertThat(infy.summary()).contains("No analysis has been published for INFY");
        assertThat(infy.sources()).containsExactly(SignalSource.WATCHLIST);
    }

    @Test
    @DisplayName("One symbol: personal context added; an unknown symbol is INS-404")
    void oneSymbol() {
        holds("TCS");
        given(watched.symbolsWatchedBy(1L)).willReturn(List.of());
        given(analysis.find("TCS")).willReturn(Optional.of(published("TCS", "BUY", 70)));

        assertThat(service.forSymbol(1L, "tcs").heldQuantity()).isEqualTo(10);
        assertThatThrownBy(() -> service.forSymbol(1L, "NOPE")).isInstanceOf(InstrumentNotFoundException.class);
    }

    @Test
    @DisplayName("Holdings are read through the portfolio layer, so its account checks apply")
    void portfolioRefusalPropagates() {
        given(accounts.getPortfolio(4L, 4L)).willThrow(new AccountNotActiveException(4L, "SUSPENDED"));

        assertThatThrownBy(() -> service.forAccount(4L)).isInstanceOf(AccountNotActiveException.class);
        verifyNoInteractions(watched);
    }
}
