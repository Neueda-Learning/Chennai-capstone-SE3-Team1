package com.team1.trading.api.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.trading.api.chat.ChatTools.ChatContext;
import com.team1.trading.api.dto.BalanceResponse;
import com.team1.trading.api.dto.CandleResponse;
import com.team1.trading.api.dto.MarketPoint;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.dto.OrderHistoryEntry;
import com.team1.trading.api.dto.PortfolioResponse;
import com.team1.trading.api.dto.PositionResponse;
import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.market.CandleService;
import com.team1.trading.api.service.AccountService;
import com.team1.trading.api.service.MarketService;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderStatus;
import com.team1.trading.domain.exception.AccountNotActiveException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class ChatToolsTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final long ACCOUNT = 7L;
    private static final Long TOKEN_ACCOUNT = 7L;

    @Mock
    private AccountService accounts;
    @Mock
    private MarketService market;
    @Mock
    private CandleService candles;
    @Mock
    private InstrumentMapper instruments;
    @Mock
    private ChatWorkspaceTools workspace;

    private ChatTools tools;
    private ChatContext context;

    @BeforeEach
    void setUp() {
        tools = new ChatTools(accounts, market, candles, instruments, workspace);
        context = new ChatContext(ACCOUNT, TOKEN_ACCOUNT, new ArrayList<>());
    }

    private static JsonNode args(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static MarketQuoteResponse quote(String symbol, String price) {
        MarketQuoteResponse q = new MarketQuoteResponse();
        q.setSymbol(symbol);
        q.setName(symbol + " Ltd");
        q.setPrice(new BigDecimal(price));
        q.setChange(BigDecimal.ONE);
        q.setChangePercent(new BigDecimal("0.5"));
        q.setMarketState("OPEN");
        q.setStale(false);
        return q;
    }

    private void holds(String symbol, int quantity, String cost) {
        given(accounts.getPortfolio(ACCOUNT, TOKEN_ACCOUNT)).willReturn(new PortfolioResponse(ACCOUNT,
                List.of(new PositionResponse(ACCOUNT, symbol, quantity, new BigDecimal(cost), BigDecimal.ZERO)), List.of()));
    }

    private void tradable(String symbol) {
        InstrumentMapper.InstrumentRow row = new InstrumentMapper.InstrumentRow();
        row.setInstrumentId(symbol);
        row.setActive(true);
        given(instruments.findRowBySymbol(symbol)).willReturn(Optional.of(row));
    }

    // ---- what the model is offered

    @Test
    @DisplayName("The model is offered six tools, none of which takes an account as an argument")
    void toolsAndTheirArguments() {
        List<String> names = tools.specs().stream().map(LlmClient.ToolSpec::name).toList();

        assertThat(names).containsExactly("get_account_summary", "get_recent_orders", "get_market_overview",
                "get_price_stats", "get_outlook", "suggest_order");
        tools.specs().forEach(spec -> assertThat(spec.parameters().path("properties").has("accountId"))
                .as("%s must not accept an account", spec.name()).isFalse());
    }

    // ---- scoping

    @Test
    @DisplayName("Account data is always read for the token's account, whatever account the model names")
    void accountComesFromTheTokenNotTheModel() {
        given(accounts.getBalance(ACCOUNT, TOKEN_ACCOUNT)).willReturn(
                new BalanceResponse(ACCOUNT, new BigDecimal("1000.00"), "INR", LocalDateTime.now()));
        given(accounts.getPortfolio(ACCOUNT, TOKEN_ACCOUNT)).willReturn(new PortfolioResponse(ACCOUNT, List.of(), List.of()));
        given(market.latestQuotes()).willReturn(List.of());

        tools.execute("get_account_summary", args("{\"accountId\":999,\"account_id\":999}"), context);
        tools.execute("get_recent_orders", args("{\"accountId\":999}"), context);

        verify(accounts).getBalance(ACCOUNT, TOKEN_ACCOUNT);
        verify(accounts).getPortfolio(ACCOUNT, TOKEN_ACCOUNT);
        verify(accounts).getOrderHistory(eq(ACCOUNT), eq(TOKEN_ACCOUNT), any(), any(), any());
        verify(accounts, never()).getBalance(eq(999L), any());
        verify(accounts, never()).getPortfolio(eq(999L), any());
    }

    @Test
    @DisplayName("A token for another account is refused by the same ownership check every route uses")
    void ownershipFailureBecomesAnError() {
        given(accounts.getBalance(ACCOUNT, TOKEN_ACCOUNT)).willThrow(new AccountNotActiveException(ACCOUNT, "TOKEN"));

        JsonNode result = tools.execute("get_account_summary", args("{}"), context);

        assertThat(result.has("error")).isTrue();
    }

    // ---- account summary

    @Test
    @DisplayName("The summary values the holdings at the latest quotes and reports concentration")
    void accountSummary() {
        given(accounts.getBalance(ACCOUNT, TOKEN_ACCOUNT)).willReturn(
                new BalanceResponse(ACCOUNT, new BigDecimal("500.00"), "INR", LocalDateTime.now()));
        holds("TCS", 10, "3000.00");
        given(market.latestQuotes()).willReturn(List.of(quote("TCS", "3500.00")));

        JsonNode result = tools.execute("get_account_summary", args("{}"), context);

        JsonNode valuation = result.get("valuation");
        assertThat(result.get("currency").asText()).isEqualTo("INR");
        assertThat(valuation.get("totalValue").decimalValue()).isEqualByComparingTo("35500.00");
        assertThat(valuation.get("unrealisedPnl").decimalValue()).isEqualByComparingTo("5000.00");
        assertThat(valuation.get("largestSymbol").asText()).isEqualTo("TCS");
        assertThat(valuation.get("holdings").get(0).get("weightPct").asDouble()).isEqualTo(98.59);
    }

    // ---- orders

    @Test
    @DisplayName("Recent orders are newest first, limited, and expose no idempotency key")
    void recentOrders() {
        List<OrderHistoryEntry> history = IntStream.range(0, 30).mapToObj(i -> new OrderHistoryEntry(
                "o-" + i, ACCOUNT, "TCS", OrderSide.BUY, 1, BigDecimal.TEN, BigDecimal.TEN, OrderStatus.FILLED,
                "secret-key-" + i, LocalDateTime.of(2026, 10, 1, 9, 0).plusMinutes(i), null)).toList();
        given(accounts.getOrderHistory(eq(ACCOUNT), eq(TOKEN_ACCOUNT), any(), any(), any())).willReturn(history);

        JsonNode result = tools.execute("get_recent_orders", args("{\"limit\":3}"), context);

        assertThat(result.get("orders")).hasSize(3);
        assertThat(result.get("orders").get(0).get("placedAt").asText()).startsWith("2026-10-01T09:29");
        assertThat(result.toString()).doesNotContain("secret-key");
        assertThat(tools.execute("get_recent_orders", args("{\"limit\":500}"), context).get("orders")).hasSize(20);
    }

    // ---- price stats

    @Test
    @DisplayName("Price stats are computed from daily closes for a known range")
    void priceStats() {
        List<CandleResponse> history = IntStream.range(0, 60).mapToObj(i -> {
            CandleResponse c = new CandleResponse();
            c.setClose(new BigDecimal(100 + i));
            return c;
        }).toList();
        given(candles.candles("TCS", "1d", "3mo")).willReturn(history);

        JsonNode result = tools.execute("get_price_stats", args("{\"symbol\":\" tcs \"}"), context);

        JsonNode stats = result.get("stats");
        assertThat(result.get("symbol").asText()).isEqualTo("TCS");
        assertThat(stats.get("lastClose").asDouble()).isEqualTo(159.0);
        assertThat(stats.get("returnPct").asDouble()).isEqualTo(59.0);
        assertThat(stats.get("rsi14").asDouble()).isEqualTo(100.0);
        assertThat(stats.get("sma50").asDouble()).isEqualTo(134.5);
    }

    @Test
    @DisplayName("An unsupported range, an unknown symbol and too little history are errors the model can explain")
    void priceStatsErrors() {
        assertThat(tools.execute("get_price_stats", args("{\"symbol\":\"TCS\",\"range\":\"5y\"}"), context).has("error")).isTrue();

        given(candles.candles("NOPE", "1d", "3mo")).willThrow(new com.team1.trading.domain.exception.InstrumentNotFoundException("NOPE"));
        assertThat(tools.execute("get_price_stats", args("{\"symbol\":\"NOPE\"}"), context).has("error")).isTrue();

        given(candles.candles("TCS", "1d", "3mo")).willReturn(List.of());
        assertThat(tools.execute("get_price_stats", args("{\"symbol\":\"TCS\"}"), context).get("error").asText())
                .contains("Not enough price history");
    }

    // ---- outlook

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** {@code days} completed daily candles ending yesterday, climbing steadily, plus today's partial candle. */
    private static List<CandleResponse> yearOfCandles(int days, boolean withToday) {
        LocalDate today = LocalDate.now(IST);
        List<CandleResponse> out = new ArrayList<>();
        for (int i = 0; i < days; i++) {
            CandleResponse c = new CandleResponse();
            c.setTime(today.minusDays(days - i).atStartOfDay(IST).toOffsetDateTime());
            double close = 100 + i * 0.5 + (i % 3);
            c.setOpen(new BigDecimal(close - 0.3));
            c.setHigh(new BigDecimal(close + 1));
            c.setLow(new BigDecimal(close - 1));
            c.setClose(new BigDecimal(close));
            c.setVolume(1_000_000L + i * 1_000L);
            out.add(c);
        }
        if (withToday) {
            CandleResponse partial = new CandleResponse();
            partial.setTime(today.atStartOfDay(IST).toOffsetDateTime());
            partial.setClose(new BigDecimal("999.00")); // a wildly wrong partial candle that must not be used
            partial.setHigh(new BigDecimal("999.00"));
            partial.setLow(new BigDecimal("999.00"));
            out.add(partial);
        }
        return out;
    }

    private void marketOf(String symbol, String price, String changePercent) {
        MarketQuoteResponse own = quote(symbol, price);
        own.setChangePercent(new BigDecimal(changePercent));
        MarketQuoteResponse up = quote("INFY", "1500");
        MarketQuoteResponse up2 = quote("ITC", "400");
        MarketQuoteResponse down = quote("RELIANCE", "2400");
        down.setChangePercent(new BigDecimal("-1.0"));
        given(market.latestQuotes()).willReturn(List.of(own, up, up2, down));
    }

    @Test
    @DisplayName("The outlook is built from a year of completed days, the live quote, the market's breadth and recent ticks")
    void outlookUsesEverything() {
        given(candles.candles("TCS", "1d", "1y")).willReturn(yearOfCandles(200, true));
        marketOf("TCS", "210.00", "1.5");
        given(market.history("TCS", 120)).willReturn(java.util.stream.IntStream.range(0, 15)
                .mapToObj(i -> new MarketPoint(OffsetDateTime.now().minusMinutes(15 - i), new BigDecimal(208 + i * 0.2))).toList());
        given(accounts.getPortfolio(ACCOUNT, TOKEN_ACCOUNT)).willReturn(new PortfolioResponse(ACCOUNT, List.of(), List.of()));
        given(accounts.getOrderHistory(eq(ACCOUNT), eq(TOKEN_ACCOUNT), any(), any(), any())).willReturn(List.of());

        JsonNode result = tools.execute("get_outlook", args("{\"symbol\":\" tcs \"}"), context);

        assertThat(result.has("error")).isFalse();
        assertThat(result.get("symbol").asText()).isEqualTo("TCS");
        assertThat(result.get("price").asDouble()).isEqualTo(210.0);          // the live quote
        assertThat(result.get("previousClose").asDouble()).isLessThan(210.0); // yesterday's close, not the 999 partial candle
        JsonNode outlook = result.get("outlook");
        assertThat(outlook.get("lean").asText()).isIn("BULLISH", "BEARISH", "NEUTRAL");
        assertThat(outlook.get("upDayChancePercent").asInt()).isBetween(40, 60);
        assertThat(outlook.get("confidence").asText()).isIn("LOW", "MODERATE");
        assertThat(outlook.get("nextDay90").get("low").asDouble()).isLessThan(210.0);
        assertThat(outlook.get("nextDay90").get("high").asDouble()).isGreaterThan(210.0);
        List<String> names = new ArrayList<>();
        outlook.get("signals").forEach(sig -> names.add(sig.get("name").asText()));
        assertThat(names).contains("trend", "momentum", "market", "intraday", "volume");
        assertThat(outlook.get("caveats").toString()).contains("not a forecast");
        verify(candles).candles("TCS", "1d", "1y");
    }

    @Test
    @DisplayName("Today's partial candle never enters the history: a 999 candle does not move the reading")
    void outlookIgnoresTodaysPartialCandle() {
        given(candles.candles("TCS", "1d", "1y")).willReturn(yearOfCandles(100, true));
        marketOf("TCS", "180.00", "0.4");
        given(market.history("TCS", 120)).willReturn(List.of());
        given(accounts.getPortfolio(ACCOUNT, TOKEN_ACCOUNT)).willReturn(new PortfolioResponse(ACCOUNT, List.of(), List.of()));
        given(accounts.getOrderHistory(eq(ACCOUNT), eq(TOKEN_ACCOUNT), any(), any(), any())).willReturn(List.of());

        JsonNode result = tools.execute("get_outlook", args("{\"symbol\":\"TCS\"}"), context);

        assertThat(result.at("/outlook/levels/high52Week").asDouble()).isLessThan(500.0);
        assertThat(result.at("/outlook/baseRates/observations").asInt()).isEqualTo(99);
    }

    @Test
    @DisplayName("The reading includes what this customer holds of the stock and has done with it, and only for this stock")
    void outlookIncludesThePosition() {
        given(candles.candles("TCS", "1d", "1y")).willReturn(yearOfCandles(100, false));
        marketOf("TCS", "180.00", "0.4");
        given(market.history("TCS", 120)).willReturn(List.of());
        holds("TCS", 25, "150.00");
        List<OrderHistoryEntry> orders = new ArrayList<>(IntStream.range(0, 5).mapToObj(i -> new OrderHistoryEntry(
                "o-" + i, ACCOUNT, "TCS", OrderSide.BUY, 5, BigDecimal.TEN, new BigDecimal("150.00"), OrderStatus.FILLED,
                "key-" + i, LocalDateTime.of(2026, 9, 1, 9, 0).plusDays(i), null)).toList());
        orders.add(new OrderHistoryEntry("other", ACCOUNT, "INFY", OrderSide.SELL, 1, BigDecimal.TEN, BigDecimal.TEN,
                OrderStatus.FILLED, "k", LocalDateTime.of(2026, 10, 1, 9, 0), null));
        given(accounts.getOrderHistory(eq(ACCOUNT), eq(TOKEN_ACCOUNT), any(), any(), any())).willReturn(orders);

        JsonNode position = tools.execute("get_outlook", args("{\"symbol\":\"TCS\"}"), context).get("yourPosition");

        assertThat(position.get("holds").asBoolean()).isTrue();
        assertThat(position.get("quantity").asInt()).isEqualTo(25);
        assertThat(position.get("averageCost").decimalValue()).isEqualByComparingTo("150.00");
        assertThat(position.get("recentOrdersInThisStock")).hasSize(3);
        assertThat(position.get("recentOrdersInThisStock").get(0).get("placedAt").asText()).startsWith("2026-09-05");
        assertThat(position.toString()).doesNotContain("INFY").doesNotContain("key-");
    }

    @Test
    @DisplayName("A customer who does not hold the stock is told so")
    void outlookWhenNotHeld() {
        given(candles.candles("TCS", "1d", "1y")).willReturn(yearOfCandles(100, false));
        marketOf("TCS", "180.00", "0.4");
        given(market.history("TCS", 120)).willReturn(List.of());
        given(accounts.getPortfolio(ACCOUNT, TOKEN_ACCOUNT)).willReturn(new PortfolioResponse(ACCOUNT, List.of(), List.of()));
        given(accounts.getOrderHistory(eq(ACCOUNT), eq(TOKEN_ACCOUNT), any(), any(), any())).willReturn(List.of());

        JsonNode position = tools.execute("get_outlook", args("{\"symbol\":\"TCS\"}"), context).get("yourPosition");

        assertThat(position.get("holds").asBoolean()).isFalse();
        assertThat(position.get("recentOrdersInThisStock")).isEmpty();
    }

    @Test
    @DisplayName("The customer's data is read for the token's account, whatever the model names")
    void outlookScopedToTheToken() {
        given(candles.candles("TCS", "1d", "1y")).willReturn(yearOfCandles(100, false));
        marketOf("TCS", "180.00", "0.4");
        given(market.history("TCS", 120)).willReturn(List.of());
        given(accounts.getPortfolio(ACCOUNT, TOKEN_ACCOUNT)).willReturn(new PortfolioResponse(ACCOUNT, List.of(), List.of()));
        given(accounts.getOrderHistory(eq(ACCOUNT), eq(TOKEN_ACCOUNT), any(), any(), any())).willReturn(List.of());

        tools.execute("get_outlook", args("{\"symbol\":\"TCS\",\"accountId\":999}"), context);

        verify(accounts, never()).getPortfolio(eq(999L), any());
        verify(accounts, never()).getOrderHistory(eq(999L), any(), any(), any(), any());
    }

    @Test
    @DisplayName("Too little history, and a symbol that cannot be traded, are errors the model can explain")
    void outlookErrors() {
        given(candles.candles("NEWCO", "1d", "1y")).willReturn(yearOfCandles(10, true));
        given(candles.candles("GHOST", "1d", "1y")).willThrow(new com.team1.trading.domain.exception.InstrumentNotFoundException("GHOST"));

        assertThat(tools.execute("get_outlook", args("{\"symbol\":\"NEWCO\"}"), context).get("error").asText())
                .contains("Not enough price history");
        assertThat(tools.execute("get_outlook", args("{\"symbol\":\"GHOST\"}"), context).has("error")).isTrue();
    }

    @Test
    @DisplayName("Without a live quote the reading falls back to the last completed close")
    void outlookWithoutAQuote() {
        given(candles.candles("TCS", "1d", "1y")).willReturn(yearOfCandles(100, false));
        given(market.latestQuotes()).willReturn(List.of());
        given(market.history("TCS", 120)).willReturn(List.of());
        given(accounts.getPortfolio(ACCOUNT, TOKEN_ACCOUNT)).willReturn(new PortfolioResponse(ACCOUNT, List.of(), List.of()));
        given(accounts.getOrderHistory(eq(ACCOUNT), eq(TOKEN_ACCOUNT), any(), any(), any())).willReturn(List.of());

        JsonNode result = tools.execute("get_outlook", args("{\"symbol\":\"TCS\"}"), context);

        assertThat(result.get("price").asDouble()).isEqualTo(result.get("previousClose").asDouble());
        assertThat(result.get("outlook").get("signals").toString()).doesNotContain("\"market\"");
    }

    // ---- suggestions

    @Test
    @DisplayName("A valid suggestion is recorded for the screen, and nothing is placed")
    void suggestionRecorded() {
        tradable("TCS");

        JsonNode result = tools.execute("suggest_order",
                args("{\"symbol\":\"tcs\",\"side\":\"buy\",\"quantity\":5,\"reason\":\"Adds a second holding\"}"), context);

        assertThat(result.get("recorded").asBoolean()).isTrue();
        assertThat(context.suggestions()).containsExactly(new OrderSuggestion("TCS", "BUY", 5, "Adds a second holding"));
    }

    @Test
    @DisplayName("A suggestion to sell more than is held is refused, so the model corrects itself")
    void cannotSuggestSellingMoreThanHeld() {
        tradable("TCS");
        holds("TCS", 3, "100");

        JsonNode result = tools.execute("suggest_order",
                args("{\"symbol\":\"TCS\",\"side\":\"SELL\",\"quantity\":10,\"reason\":\"x\"}"), context);

        assertThat(result.get("error").asText()).contains("holds 3");
        assertThat(context.suggestions()).isEmpty();
    }

    @Test
    @DisplayName("Selling no more than is held is allowed")
    void sellWithinHoldings() {
        tradable("TCS");
        holds("TCS", 10, "100");

        tools.execute("suggest_order", args("{\"symbol\":\"TCS\",\"side\":\"SELL\",\"quantity\":10,\"reason\":\"Trim\"}"), context);

        assertThat(context.suggestions()).hasSize(1);
    }

    @Test
    @DisplayName("Bad sides, quantities and instruments are all refused")
    void invalidSuggestions() {
        given(instruments.findRowBySymbol("GHOST")).willReturn(Optional.empty());

        assertThat(tools.execute("suggest_order", args("{\"symbol\":\"TCS\",\"side\":\"HOLD\",\"quantity\":1,\"reason\":\"x\"}"), context).has("error")).isTrue();
        assertThat(tools.execute("suggest_order", args("{\"symbol\":\"TCS\",\"side\":\"BUY\",\"quantity\":0,\"reason\":\"x\"}"), context).has("error")).isTrue();
        assertThat(tools.execute("suggest_order", args("{\"symbol\":\"TCS\",\"side\":\"BUY\",\"quantity\":-5,\"reason\":\"x\"}"), context).has("error")).isTrue();
        assertThat(tools.execute("suggest_order", args("{\"symbol\":\"TCS\",\"side\":\"BUY\",\"quantity\":999999,\"reason\":\"x\"}"), context).has("error")).isTrue();
        assertThat(tools.execute("suggest_order", args("{\"symbol\":\"GHOST\",\"side\":\"BUY\",\"quantity\":1,\"reason\":\"x\"}"), context).has("error")).isTrue();
        assertThat(context.suggestions()).isEmpty();
    }

    @Test
    @DisplayName("At most three suggestions per answer")
    void suggestionCap() {
        tradable("TCS");
        for (int i = 0; i < 3; i++) {
            tools.execute("suggest_order", args("{\"symbol\":\"TCS\",\"side\":\"BUY\",\"quantity\":1,\"reason\":\"r\"}"), context);
        }

        JsonNode fourth = tools.execute("suggest_order", args("{\"symbol\":\"TCS\",\"side\":\"BUY\",\"quantity\":1,\"reason\":\"r\"}"), context);

        assertThat(fourth.has("error")).isTrue();
        assertThat(context.suggestions()).hasSize(3);
    }

    @Test
    @DisplayName("Control characters in a suggestion's reason are removed and a long one is cut")
    void reasonIsCleaned() {
        tradable("TCS");

        tools.execute("suggest_order", args("{\"symbol\":\"TCS\",\"side\":\"BUY\",\"quantity\":1,\"reason\":\"a\\r\\nb"
                + "x".repeat(400) + "\"}"), context);

        String reason = context.suggestions().get(0).reason();
        assertThat(reason).doesNotContain("\r").doesNotContain("\n");
        assertThat(reason.length()).isEqualTo(300);
    }

    // ---- the alerts, watchlists and navigation tools live in their own class

    @Test
    @DisplayName("Their tools are offered alongside these, and run through the same scoping and error handling")
    void delegatesToTheWorkspaceTools() {
        LlmClient.ToolSpec extra = new LlmClient.ToolSpec("propose_alert", "d", JSON.createObjectNode());
        given(workspace.specs()).willReturn(List.of(extra));
        given(workspace.handles("propose_alert")).willReturn(true);
        given(workspace.execute(org.mockito.ArgumentMatchers.eq("propose_alert"), any(), org.mockito.ArgumentMatchers.same(context)))
                .willReturn(args("{\"recorded\":true}"));

        assertThat(tools.specs().stream().map(LlmClient.ToolSpec::name).toList()).endsWith("propose_alert");
        assertThat(tools.execute("propose_alert", args("{}"), context).get("recorded").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("A failure inside one of their tools is an error result, never an exception")
    void workspaceFailureBecomesAResult() {
        given(workspace.handles("get_alerts")).willReturn(true);
        given(workspace.execute(org.mockito.ArgumentMatchers.eq("get_alerts"), any(), any())).willThrow(new IllegalStateException("db down"));

        JsonNode result = tools.execute("get_alerts", args("{}"), context);

        assertThat(result.get("error").asText()).isEqualTo("That data could not be read right now.");
    }

    // ---- failure handling

    @Test
    @DisplayName("An unknown tool, or a tool that blows up, yields an error result and never an exception")
    void failuresBecomeResults() {
        given(market.latestQuotes()).willThrow(new IllegalStateException("db down: password=hunter2"));

        JsonNode unknown = tools.execute("drop_all_tables", args("{}"), context);
        JsonNode broken = tools.execute("get_market_overview", args("{}"), context);

        assertThat(unknown.get("error").asText()).contains("Unknown tool");
        assertThat(broken.get("error").asText()).isEqualTo("That data could not be read right now.");
        assertThat(broken.toString()).doesNotContain("hunter2"); // internals do not reach the model
    }

    @Test
    @DisplayName("Null or missing arguments are tolerated")
    void nullArguments() {
        given(market.latestQuotes()).willReturn(List.of(quote("TCS", "3500")));

        assertThat(tools.execute("get_market_overview", null, context).get("instruments")).hasSize(1);
    }
}
