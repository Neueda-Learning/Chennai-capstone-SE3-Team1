package com.team1.trading.api.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.trading.api.chat.ChatAction.AlertProposal;
import com.team1.trading.api.chat.ChatAction.NavigationLink;
import com.team1.trading.api.chat.ChatAction.WatchlistProposal;
import com.team1.trading.api.chat.ChatTools.ChatContext;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.notifications.Direction;
import com.team1.trading.api.service.MarketService;
import com.team1.trading.api.watchlists.AlertDeliveryState;
import com.team1.trading.api.watchlists.AlertResponse;
import com.team1.trading.api.watchlists.AlertService;
import com.team1.trading.api.watchlists.AlertState;
import com.team1.trading.api.watchlists.WatchlistEntryResponse;
import com.team1.trading.api.watchlists.WatchlistResponse;
import com.team1.trading.api.watchlists.WatchlistService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ChatWorkspaceToolsTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final long ACCOUNT = 7L;

    @Mock
    private AlertService alerts;
    @Mock
    private WatchlistService watchlists;
    @Mock
    private MarketService market;
    @Mock
    private InstrumentMapper instruments;

    private ChatWorkspaceTools tools;
    private ChatContext context;

    @BeforeEach
    void setUp() {
        tools = new ChatWorkspaceTools(alerts, watchlists, market, instruments);
        context = new ChatContext(ACCOUNT, ACCOUNT, new ArrayList<>());
        for (String symbol : List.of("TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN", "RELIANCE")) {
            tradable(symbol);
        }
        quotes(quote("TCS", "3000.00"), quote("INFY", "1500.00"), quote("HDFCBANK", "1700.00"));
        given(alerts.list(ACCOUNT)).willReturn(List.of());
        given(watchlists.list(ACCOUNT)).willReturn(List.of());
    }

    private static JsonNode args(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private void tradable(String symbol) {
        InstrumentMapper.InstrumentRow row = new InstrumentMapper.InstrumentRow();
        row.setInstrumentId(symbol);
        row.setActive(true);
        given(instruments.findRowBySymbol(symbol)).willReturn(Optional.of(row));
    }

    private static MarketQuoteResponse quote(String symbol, String price) {
        MarketQuoteResponse q = new MarketQuoteResponse();
        q.setSymbol(symbol);
        q.setPrice(new BigDecimal(price));
        return q;
    }

    private void quotes(MarketQuoteResponse... quotes) {
        given(market.latestQuotes()).willReturn(List.of(quotes));
    }

    private static AlertResponse alert(String symbol, String level, Direction direction, AlertState state) {
        return new AlertResponse("a-" + symbol + level, symbol, new BigDecimal(level), direction, state,
                (AlertDeliveryState) null, state == AlertState.FIRED ? OffsetDateTime.parse("2026-10-06T09:30:00Z") : null,
                state == AlertState.FIRED ? new BigDecimal(level) : null, OffsetDateTime.parse("2026-10-06T09:00:00Z"));
    }

    private static WatchlistEntryResponse entry(String symbol) {
        return new WatchlistEntryResponse(symbol, symbol + " Ltd", new BigDecimal("100.00"), "INR", new BigDecimal("0.5"), false, null);
    }

    private static WatchlistResponse list(String id, String name, String... symbols) {
        return new WatchlistResponse(id, name, OffsetDateTime.parse("2026-10-06T09:00:00Z"),
                java.util.Arrays.stream(symbols).map(ChatWorkspaceToolsTest::entry).toList());
    }

    private JsonNode run(String tool, String json) {
        return tools.execute(tool, args(json), context);
    }

    // ---- what the model is offered

    @Test
    @DisplayName("The five tools are offered, none takes an account, and the symbol list is declared as an array of strings")
    void specs() {
        var specs = tools.specs();

        assertThat(specs.stream().map(s -> s.name()).toList()).containsExactly(
                "get_alerts", "get_watchlists", "propose_alert", "propose_watchlist", "suggest_navigation");
        specs.forEach(spec -> assertThat(spec.parameters().path("properties").has("accountId")).isFalse());
        JsonNode symbols = specs.get(3).parameters().at("/properties/symbols");
        assertThat(symbols.get("type").asText()).isEqualTo("ARRAY");
        assertThat(symbols.at("/items/type").asText()).isEqualTo("STRING");
        assertThat(specs.get(3).parameters().get("required").toString()).contains("name", "symbols", "reason");
    }

    @Test
    @DisplayName("It handles exactly its own tools")
    void handles() {
        assertThat(tools.handles("get_alerts")).isTrue();
        assertThat(tools.handles("suggest_navigation")).isTrue();
        assertThat(tools.handles("get_account_summary")).isFalse();
        assertThat(tools.handles("delete_alert")).isFalse();
    }

    // ---- reading

    @Test
    @DisplayName("Alerts are read for the token's account only, with how far each waiting alert is from its level")
    void getAlerts() {
        given(alerts.list(ACCOUNT)).willReturn(List.of(
                alert("TCS", "3150.00", Direction.ABOVE, AlertState.ARMED),
                alert("INFY", "1400.00", Direction.BELOW, AlertState.FIRED)));

        JsonNode result = run("get_alerts", "{\"accountId\":999}");

        verify(alerts).list(ACCOUNT);
        verify(alerts, never()).list(999L);
        JsonNode first = result.get("alerts").get(0);
        assertThat(first.get("symbol").asText()).isEqualTo("TCS");
        assertThat(first.get("state").asText()).isEqualTo("ARMED");
        assertThat(first.get("percentAway").decimalValue()).isEqualByComparingTo("5.0");
        assertThat(first.get("waitsFor").asText()).contains("rise");
        JsonNode fired = result.get("alerts").get(1);
        assertThat(fired.has("percentAway")).isFalse();
        assertThat(fired.get("firedPrice").decimalValue()).isEqualByComparingTo("1400.00");
        assertThat(result.get("limit").asInt()).isEqualTo(25);
    }

    @Test
    @DisplayName("Watchlists are read with their stocks and prices, and the limits")
    void getWatchlists() {
        given(watchlists.list(ACCOUNT)).willReturn(List.of(list("w1", "Banks", "HDFCBANK", "SBIN")));

        JsonNode result = run("get_watchlists", "{}");

        assertThat(result.get("watchlists").get(0).get("name").asText()).isEqualTo("Banks");
        assertThat(result.get("watchlists").get(0).get("instruments")).hasSize(2);
        assertThat(result.get("limitPerAccount").asInt()).isEqualTo(10);
        assertThat(result.get("limitPerList").asInt()).isEqualTo(50);
        assertThat(result.toString()).doesNotContain("w1"); // ids are not for the model
    }

    // ---- proposing an alert

    @Test
    @DisplayName("A level below the price is a fall alert and one above it a rise alert, worked out in code")
    void directionIsInferred() {
        run("propose_alert", "{\"symbol\":\"tcs\",\"threshold\":2850,\"reason\":\"Support\"}");
        run("propose_alert", "{\"symbol\":\"INFY\",\"threshold\":1600,\"reason\":\"Resistance\",\"direction\":\"BELOW\"}");

        assertThat(context.alertProposals()).extracting(AlertProposal::symbol, AlertProposal::direction)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("TCS", "BELOW"), org.assertj.core.groups.Tuple.tuple("INFY", "ABOVE"));
        AlertProposal first = context.alertProposals().get(0);
        assertThat(first.threshold()).isEqualByComparingTo("2850.00");
        assertThat(first.currentPrice()).isEqualByComparingTo("3000.00");
        assertThat(first.percentFromNow()).isEqualTo(-5.0);
        assertThat(first.reason()).isEqualTo("Support");
    }

    @Test
    @DisplayName("The result tells the model nothing has been created, and says which way and how far")
    void proposalResult() {
        JsonNode result = run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":3150,\"reason\":\"r\"}");

        assertThat(result.get("recorded").asBoolean()).isTrue();
        assertThat(result.get("direction").asText()).isEqualTo("ABOVE");
        assertThat(result.get("percentFromNow").asDouble()).isEqualTo(5.0);
        assertThat(result.get("note").asText()).contains("Nothing has been created");
        verify(alerts, never()).create(anyLong(), any());
    }

    @Test
    @DisplayName("A level is accepted as text with commas, rounded to the paisa")
    void thresholdFormats() {
        run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":\"3,150.456\",\"reason\":\"r\"}");

        assertThat(context.alertProposals().get(0).threshold()).isEqualByComparingTo("3150.46");
    }

    @Test
    @DisplayName("Levels that are not a sensible price, or are nowhere near this stock's, are refused")
    void insensibleLevels() {
        for (String bad : List.of("0", "-5", "\"abc\"", "null", "0.001")) {
            assertThat(run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":" + bad + ",\"reason\":\"r\"}").has("error"))
                    .as("threshold %s", bad).isTrue();
        }
        JsonNode far = run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":30000,\"reason\":\"r\"}");
        JsonNode tiny = run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":300,\"reason\":\"r\"}");
        JsonNode same = run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":3000,\"reason\":\"r\"}");

        assertThat(far.get("error").asText()).contains("far from");
        assertThat(tiny.get("error").asText()).contains("far from");
        assertThat(same.get("error").asText()).contains("already trading");
        assertThat(context.alertProposals()).isEmpty();
    }

    @Test
    @DisplayName("An unknown symbol, a missing symbol, and a stock with no live price are errors the model can explain")
    void symbolProblems() {
        given(instruments.findRowBySymbol("GHOST")).willReturn(Optional.empty());
        tradable("WIPRO"); // tradable, but no quote

        assertThat(run("propose_alert", "{\"symbol\":\"GHOST\",\"threshold\":10,\"reason\":\"r\"}").get("error").asText()).contains("not an instrument");
        assertThat(run("propose_alert", "{\"threshold\":10,\"reason\":\"r\"}").get("error").asText()).contains("symbol is needed");
        assertThat(run("propose_alert", "{\"symbol\":\"WIPRO\",\"threshold\":10,\"reason\":\"r\"}").get("error").asText()).contains("no live price");
        assertThat(context.alertProposals()).isEmpty();
    }

    @Test
    @DisplayName("An alert the customer already has watching is not proposed again, but one that has fired or is off may be")
    void duplicates() {
        given(alerts.list(ACCOUNT)).willReturn(List.of(
                alert("TCS", "3150.00", Direction.ABOVE, AlertState.ARMED),
                alert("INFY", "1600.00", Direction.ABOVE, AlertState.FIRED),
                alert("HDFCBANK", "1800.00", Direction.ABOVE, AlertState.DISABLED)));

        assertThat(run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":3150,\"reason\":\"r\"}").get("error").asText()).contains("already has");
        assertThat(run("propose_alert", "{\"symbol\":\"INFY\",\"threshold\":1600,\"reason\":\"r\"}").has("error")).isFalse();
        assertThat(run("propose_alert", "{\"symbol\":\"HDFCBANK\",\"threshold\":1800,\"reason\":\"r\"}").has("error")).isFalse();
        assertThat(context.alertProposals()).hasSize(2);
    }

    @Test
    @DisplayName("The same proposal twice in one answer is refused")
    void duplicateWithinAnswer() {
        run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":3150,\"reason\":\"r\"}");

        assertThat(run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":3150,\"reason\":\"r\"}").get("error").asText()).contains("already proposed");
        assertThat(context.alertProposals()).hasSize(1);
    }

    @Test
    @DisplayName("At most three alert proposals per answer")
    void alertCap() {
        for (int i = 1; i <= 3; i++) {
            run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":" + (3000 + i * 50) + ",\"reason\":\"r\"}");
        }

        JsonNode fourth = run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":3500,\"reason\":\"r\"}");

        assertThat(fourth.get("error").asText()).contains("At most 3");
        assertThat(context.alertProposals()).hasSize(3);
    }

    @Test
    @DisplayName("Nothing is proposed that the account could not hold: the 25-alert limit counts what is already proposed")
    void accountLimit() {
        given(alerts.list(ACCOUNT)).willReturn(IntStream.range(0, 25)
                .mapToObj(i -> alert("INFY", String.valueOf(1000 + i), Direction.ABOVE, AlertState.FIRED)).toList());

        JsonNode result = run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":3150,\"reason\":\"r\"}");

        assertThat(result.get("error").asText()).contains("most an account can hold");
    }

    @Test
    @DisplayName("The reason is cleaned of control characters and cut")
    void reasonCleaned() {
        run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":3150,\"reason\":\"a\\r\\nb" + "x".repeat(400) + "\"}");

        String reason = context.alertProposals().get(0).reason();
        assertThat(reason).doesNotContain("\r").doesNotContain("\n");
        assertThat(reason.length()).isLessThanOrEqualTo(300);
    }

    // ---- proposing a watchlist

    @Test
    @DisplayName("A new watchlist is proposed with real symbols, upper-cased and without repeats")
    void createWatchlist() {
        JsonNode result = run("propose_watchlist",
                "{\"name\":\"  Banks \",\"symbols\":[\"hdfcbank\",\"ICICIBANK\",\"HDFCBANK\",\" sbin \"],\"reason\":\"Large lenders\"}");

        assertThat(result.get("recorded").asBoolean()).isTrue();
        assertThat(result.get("mode").asText()).isEqualTo("CREATE");
        WatchlistProposal proposal = context.watchlistProposals().get(0);
        assertThat(proposal.name()).isEqualTo("Banks");
        assertThat(proposal.symbols()).containsExactly("HDFCBANK", "ICICIBANK", "SBIN");
        assertThat(proposal.watchlistId()).isNull();
        assertThat(proposal.reason()).isEqualTo("Large lenders");
        verify(watchlists, never()).create(anyLong(), any());
    }

    @Test
    @DisplayName("Symbols that cannot be traded are refused by name, so the model can correct itself")
    void unknownSymbols() {
        given(instruments.findRowBySymbol("FAKEBANK")).willReturn(Optional.empty());

        JsonNode result = run("propose_watchlist", "{\"name\":\"Banks\",\"symbols\":[\"SBIN\",\"FAKEBANK\"],\"reason\":\"r\"}");

        assertThat(result.get("error").asText()).contains("FAKEBANK").contains("get_market_overview");
        assertThat(result.get("unknownSymbols")).hasSize(1);
        assertThat(context.watchlistProposals()).isEmpty();
    }

    @Test
    @DisplayName("A name that matches a watchlist the customer has, in any case, adds only the stocks not already on it")
    void addToExisting() {
        given(watchlists.list(ACCOUNT)).willReturn(List.of(list("w1", "Banks", "HDFCBANK")));

        JsonNode result = run("propose_watchlist", "{\"name\":\"BANKS\",\"symbols\":[\"HDFCBANK\",\"SBIN\"],\"reason\":\"r\"}");

        assertThat(result.get("mode").asText()).isEqualTo("ADD");
        WatchlistProposal proposal = context.watchlistProposals().get(0);
        assertThat(proposal.name()).isEqualTo("Banks"); // their spelling
        assertThat(proposal.watchlistId()).isEqualTo("w1");
        assertThat(proposal.symbols()).containsExactly("SBIN");
    }

    @Test
    @DisplayName("Offering stocks that are all already on the list is refused")
    void nothingNew() {
        given(watchlists.list(ACCOUNT)).willReturn(List.of(list("w1", "Banks", "HDFCBANK", "SBIN")));

        assertThat(run("propose_watchlist", "{\"name\":\"Banks\",\"symbols\":[\"SBIN\"],\"reason\":\"r\"}").get("error").asText())
                .contains("already on");
    }

    @Test
    @DisplayName("The limits of a list (50) and of an account (10 lists) are respected")
    void limits() {
        given(watchlists.list(ACCOUNT)).willReturn(List.of(list("w1", "Big",
                IntStream.range(0, 50).mapToObj(i -> "S" + i).toArray(String[]::new))));
        assertThat(run("propose_watchlist", "{\"name\":\"Big\",\"symbols\":[\"SBIN\"],\"reason\":\"r\"}").get("error").asText())
                .contains("at most 50");

        given(watchlists.list(ACCOUNT)).willReturn(IntStream.range(0, 10).mapToObj(i -> list("w" + i, "List " + i, "SBIN")).toList());
        assertThat(run("propose_watchlist", "{\"name\":\"One more\",\"symbols\":[\"TCS\"],\"reason\":\"r\"}").get("error").asText())
                .contains("most watchlists");
        // ...but adding to one they already have is fine at the limit
        assertThat(run("propose_watchlist", "{\"name\":\"List 3\",\"symbols\":[\"TCS\"],\"reason\":\"r\"}").has("error")).isFalse();
    }

    @Test
    @DisplayName("A watchlist proposal needs a name and a real list of symbols, and not too many")
    void malformed() {
        for (String bad : List.of(
                "{\"symbols\":[\"TCS\"],\"reason\":\"r\"}",
                "{\"name\":\"   \",\"symbols\":[\"TCS\"],\"reason\":\"r\"}",
                "{\"name\":\"X\",\"reason\":\"r\"}",
                "{\"name\":\"X\",\"symbols\":[],\"reason\":\"r\"}",
                "{\"name\":\"X\",\"symbols\":\"TCS\",\"reason\":\"r\"}",
                "{\"name\":\"X\",\"symbols\":[\"\",\"  \"],\"reason\":\"r\"}")) {
            assertThat(run("propose_watchlist", bad).has("error")).as(bad).isTrue();
        }
        String many = IntStream.range(0, 26).mapToObj(i -> "\"S" + i + "\"").reduce((a, b) -> a + "," + b).orElseThrow();
        assertThat(run("propose_watchlist", "{\"name\":\"X\",\"symbols\":[" + many + "],\"reason\":\"r\"}").get("error").asText()).contains("At most 25");
        assertThat(context.watchlistProposals()).isEmpty();
    }

    @Test
    @DisplayName("The name is cleaned and cut, and at most two proposals, with distinct names, per answer")
    void nameAndCaps() {
        run("propose_watchlist", "{\"name\":\"Ban\\nks" + "x".repeat(100) + "\",\"symbols\":[\"SBIN\"],\"reason\":\"r\"}");
        assertThat(context.watchlistProposals().get(0).name()).doesNotContain("\n").hasSizeLessThanOrEqualTo(60);

        assertThat(run("propose_watchlist", "{\"name\":\"" + context.watchlistProposals().get(0).name() + "\",\"symbols\":[\"TCS\"],\"reason\":\"r\"}")
                .get("error").asText()).contains("already proposed");
        run("propose_watchlist", "{\"name\":\"IT\",\"symbols\":[\"TCS\",\"INFY\"],\"reason\":\"r\"}");
        assertThat(run("propose_watchlist", "{\"name\":\"Third\",\"symbols\":[\"RELIANCE\"],\"reason\":\"r\"}").get("error").asText()).contains("At most 2");
        assertThat(context.watchlistProposals()).hasSize(2);
    }

    // ---- navigation

    @Test
    @DisplayName("Each page of the app can be linked to, with a default label")
    void destinations() {
        Map<String, String> paths = Map.of(
                "DASHBOARD", "/app/dashboard", "PORTFOLIO", "/app/portfolio", "MARKET_AND_TRADE", "/app/orders",
                "BLOTTER", "/app/blotter", "WATCHLISTS", "/app/watchlists", "ACCOUNT", "/app/account",
                "SETTINGS", "/app/settings", "BANK_ACCOUNT", "/app/bank-accounts");
        for (var e : paths.entrySet()) {
            context = new ChatContext(ACCOUNT, ACCOUNT, new ArrayList<>());
            run("suggest_navigation", "{\"destination\":\"" + e.getKey().toLowerCase() + "\"}");

            NavigationLink link = context.links().get(0);
            assertThat(link.path()).as(e.getKey()).isEqualTo(e.getValue());
            assertThat(link.label()).startsWith("Go to ");
            assertThat(link.query()).isEmpty();
        }
    }

    @Test
    @DisplayName("Only the app's own pages: an unknown destination, or a path, is refused")
    void allowlist() {
        for (String bad : List.of("\"/admin\"", "\"https://evil.example\"", "\"LOGIN\"", "\"\"", "null")) {
            assertThat(run("suggest_navigation", "{\"destination\":" + bad + "}").has("error")).as(bad).isTrue();
        }
        assertThat(context.links()).isEmpty();
    }

    @Test
    @DisplayName("Market & Trade can open on a stock, pre-filled with a side and quantity, all validated")
    void marketLink() {
        run("suggest_navigation", "{\"destination\":\"MARKET_AND_TRADE\",\"symbol\":\"tcs\",\"side\":\"sell\",\"quantity\":20,\"label\":\"Sell 20 TCS\"}");

        NavigationLink link = context.links().get(0);
        assertThat(link.label()).isEqualTo("Sell 20 TCS");
        assertThat(link.query()).containsExactly(Map.entry("symbol", "TCS"), Map.entry("side", "SELL"), Map.entry("quantity", "20"));
    }

    @Test
    @DisplayName("A bad side or quantity is left out, and an unknown stock is refused")
    void marketLinkValidation() {
        run("suggest_navigation", "{\"destination\":\"MARKET_AND_TRADE\",\"symbol\":\"TCS\",\"side\":\"HOLD\",\"quantity\":5}");
        run("suggest_navigation", "{\"destination\":\"MARKET_AND_TRADE\",\"symbol\":\"INFY\",\"side\":\"BUY\",\"quantity\":999999}");
        given(instruments.findRowBySymbol("GHOST")).willReturn(Optional.empty());
        JsonNode ghost = run("suggest_navigation", "{\"destination\":\"MARKET_AND_TRADE\",\"symbol\":\"GHOST\"}");

        assertThat(context.links().get(0).query()).containsExactly(Map.entry("symbol", "TCS"));
        assertThat(context.links().get(1).query()).containsExactly(Map.entry("symbol", "INFY"), Map.entry("side", "BUY"));
        assertThat(ghost.has("error")).isTrue();
    }

    @Test
    @DisplayName("Watchlists can open a stock's alert chart, and the blotter a search, and nothing leaks onto other pages")
    void otherQueries() {
        run("suggest_navigation", "{\"destination\":\"WATCHLISTS\",\"symbol\":\"TCS\"}");
        run("suggest_navigation", "{\"destination\":\"BLOTTER\",\"search\":\"  INFY  \",\"symbol\":\"TCS\"}");
        run("suggest_navigation", "{\"destination\":\"PORTFOLIO\",\"symbol\":\"TCS\",\"search\":\"x\"}");

        assertThat(context.links().get(0).query()).containsExactly(Map.entry("alert", "TCS"));
        assertThat(context.links().get(1).query()).containsExactly(Map.entry("q", "INFY"));
        assertThat(context.links().get(2).query()).isEmpty();
    }

    @Test
    @DisplayName("A label is cleaned and cut; at most three links, and the same link is not offered twice")
    void linkCaps() {
        run("suggest_navigation", "{\"destination\":\"SETTINGS\",\"label\":\"Op\\nen " + "y".repeat(100) + "\"}");
        assertThat(context.links().get(0).label()).doesNotContain("\n").hasSizeLessThanOrEqualTo(60);

        assertThat(run("suggest_navigation", "{\"destination\":\"SETTINGS\"}").get("error").asText()).contains("already offered");
        run("suggest_navigation", "{\"destination\":\"ACCOUNT\"}");
        run("suggest_navigation", "{\"destination\":\"BLOTTER\"}");
        assertThat(run("suggest_navigation", "{\"destination\":\"DASHBOARD\"}").get("error").asText()).contains("At most 3");
        assertThat(context.links()).hasSize(3);
    }

    @Test
    @DisplayName("Nothing here changes data: no alert or watchlist is ever created, changed or deleted by a tool")
    void readOnlyOnTheBackend() {
        run("propose_alert", "{\"symbol\":\"TCS\",\"threshold\":3150,\"reason\":\"r\"}");
        run("propose_watchlist", "{\"name\":\"Banks\",\"symbols\":[\"SBIN\"],\"reason\":\"r\"}");
        run("suggest_navigation", "{\"destination\":\"WATCHLISTS\"}");

        verify(alerts, never()).create(anyLong(), any());
        verify(alerts, never()).update(anyLong(), any(), any());
        verify(alerts, never()).delete(anyLong(), any());
        verify(watchlists, never()).create(anyLong(), any());
        verify(watchlists, never()).addInstrument(anyLong(), any(), any());
        verify(watchlists, never()).delete(anyLong(), any());
        verify(watchlists, never()).removeInstrument(anyLong(), any(), any());
    }
}
