package com.team1.trading.api.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.team1.trading.api.chat.ChatAction.AlertProposal;
import com.team1.trading.api.chat.ChatAction.NavigationLink;
import com.team1.trading.api.chat.ChatAction.WatchlistProposal;
import com.team1.trading.api.chat.LlmClient.ToolSpec;
import com.team1.trading.api.dto.BalanceResponse;
import com.team1.trading.api.dto.CandleResponse;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.dto.OrderHistoryEntry;
import com.team1.trading.api.dto.PortfolioResponse;
import com.team1.trading.api.dto.MarketPoint;
import com.team1.trading.api.dto.PositionResponse;
import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.market.CandleService;
import com.team1.trading.api.service.AccountService;
import com.team1.trading.api.service.MarketService;
import com.team1.trading.domain.exception.DomainException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The only things the assistant can see or do. Every tool is read-only except suggest_order, which
 * records a suggestion for the screen to offer as a pre-filled order form and executes nothing.
 *
 * The account is never an argument. It comes from the verified token (ChatContext), so nothing the
 * model writes, however it was prompted, can point a tool at another user's data.
 */
@Component
public class ChatTools {

    public static final String ACCOUNT_SUMMARY = "get_account_summary";
    public static final String RECENT_ORDERS = "get_recent_orders";
    public static final String MARKET_OVERVIEW = "get_market_overview";
    public static final String PRICE_STATS = "get_price_stats";
    public static final String OUTLOOK = "get_outlook";
    public static final String SUGGEST_ORDER = "suggest_order";

    static final int MAX_SUGGESTIONS = 3;
    static final int MAX_SUGGESTED_QUANTITY = 10_000;
    static final int DEFAULT_ORDERS = 10;
    static final int MAX_ORDERS = 20;
    static final String DEFAULT_RANGE = "3mo";
    static final Set<String> RANGES = Set.of("1mo", "3mo", "6mo", "1y");

    private static final Logger log = LoggerFactory.getLogger(ChatTools.class);
    private static final ZoneId MARKET_ZONE = ZoneId.of("Asia/Kolkata");
    private static final ObjectMapper JSON = new ObjectMapper();

    private final AccountService accounts;
    private final MarketService market;
    private final CandleService candles;
    private final InstrumentMapper instruments;
    private final ChatWorkspaceTools workspace;

    public ChatTools(AccountService accounts, MarketService market, CandleService candles,
                     InstrumentMapper instruments, ChatWorkspaceTools workspace) {
        this.accounts = accounts;
        this.market = market;
        this.candles = candles;
        this.instruments = instruments;
        this.workspace = workspace;
    }

    /** One conversation turn's scope: who is asking, and the suggestions collected so far. */
    public record ChatContext(
            long accountId,
            Long tokenAccountId,
            List<OrderSuggestion> suggestions,
            List<AlertProposal> alertProposals,
            List<WatchlistProposal> watchlistProposals,
            List<NavigationLink> links) {

        public ChatContext(long accountId, Long tokenAccountId, List<OrderSuggestion> suggestions) {
            this(accountId, tokenAccountId, suggestions, new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
        }
    }

    public List<ToolSpec> specs() {
        List<ToolSpec> own = List.of(
                spec(ACCOUNT_SUMMARY,
                        "The user's cash balance and holdings valued at the latest prices: quantity, average cost, "
                                + "current price, value, profit or loss and share of the portfolio for each holding, plus "
                                + "how concentrated the portfolio is. Call this for any question about their portfolio.",
                        schema()),
                spec(RECENT_ORDERS,
                        "The user's most recent orders, newest first, with side, quantity, price, status and any "
                                + "rejection reason.",
                        schema().prop("limit", "INTEGER", "How many orders, 1 to " + MAX_ORDERS + " (default "
                                + DEFAULT_ORDERS + ")")
                                .prop("status", "STRING", "Optional filter: NEW, FILLED, REJECTED or CANCELLED")),
                spec(MARKET_OVERVIEW,
                        "The latest price, change and change percent of every instrument that can be traded.",
                        schema()),
                spec(PRICE_STATS,
                        "Statistics for one stock over a period from its daily closing prices: return, high, low, "
                                + "20 and 50 day moving averages, RSI(14), annualised volatility and the largest fall "
                                + "from a peak. Use it to judge a stock's trend and risk.",
                        schema().prop("symbol", "STRING", "The stock symbol, for example TCS").required("symbol")
                                .prop("range", "STRING", "1mo, 3mo, 6mo or 1y (default " + DEFAULT_RANGE + ")")),
                spec(OUTLOOK,
                        "A statistical reading of where one stock stands and how it has typically moved, built from "
                                + "its year of daily prices and volumes, the live quote, recent intraday prices, how the "
                                + "rest of the market is trading today, and the customer's own position in it. Returns "
                                + "a lean (bullish, bearish or neutral) with the signals for and against, an indicative "
                                + "chance of an up day (kept between 40 and 60 because direction is close to a coin flip), "
                                + "typical and 90% price ranges for tomorrow and the next five days, key levels, "
                                + "volatility, historical base rates and caveats. Use it for any question about where a "
                                + "stock may go, whether to buy or sell it, or what to expect.",
                        schema().prop("symbol", "STRING", "The stock symbol, for example TCS").required("symbol")),
                spec(SUGGEST_ORDER,
                        "Offer the user a concrete order to consider. This does NOT place an order: it only shows "
                                + "the user a button that opens the order form pre-filled. Use at most "
                                + MAX_SUGGESTIONS + " per answer, only when you are recommending an action, and give "
                                + "the reason in plain words.",
                        schema().prop("symbol", "STRING", "The stock symbol").required("symbol")
                                .prop("side", "STRING", "BUY or SELL").required("side")
                                .prop("quantity", "INTEGER", "Number of shares, a whole number").required("quantity")
                                .prop("reason", "STRING", "One sentence on why").required("reason")));
        List<ToolSpec> all = new ArrayList<>(own);
        all.addAll(workspace.specs());
        return all;
    }

    /** Runs one tool. Never throws: a failure becomes an {"error": ...} result the model can explain. */
    public JsonNode execute(String name, JsonNode args, ChatContext context) {
        JsonNode safeArgs = args == null || args.isNull() ? JSON.createObjectNode() : args;
        try {
            return switch (name) {
                case ACCOUNT_SUMMARY -> accountSummary(context);
                case RECENT_ORDERS -> recentOrders(safeArgs, context);
                case MARKET_OVERVIEW -> marketOverview();
                case PRICE_STATS -> priceStats(safeArgs);
                case OUTLOOK -> outlook(safeArgs, context);
                case SUGGEST_ORDER -> suggestOrder(safeArgs, context);
                default -> workspace.handles(name) ? workspace.execute(name, safeArgs, context) : error("Unknown tool " + name);
            };
        } catch (DomainException e) {
            return error(e.getMessage());
        } catch (RuntimeException e) {
            log.warn("[chat] tool {} failed: {}", name, e.getClass().getSimpleName());
            return error("That data could not be read right now.");
        }
    }

    // ---- tools

    private JsonNode accountSummary(ChatContext ctx) {
        BalanceResponse balance = accounts.getBalance(ctx.accountId(), ctx.tokenAccountId());
        PortfolioResponse portfolio = accounts.getPortfolio(ctx.accountId(), ctx.tokenAccountId());
        PortfolioAnalytics.Valuation valuation = PortfolioAnalytics.valuate(
                portfolio.getHoldings() == null ? List.of() : portfolio.getHoldings(),
                latestPrices(), balance.getCashBalance());

        ObjectNode out = JSON.createObjectNode();
        out.put("currency", balance.getCurrency());
        out.set("valuation", JSON.valueToTree(valuation));
        if (!valuation.unpriced().isEmpty()) {
            out.put("note", "No live price for " + String.join(", ", valuation.unpriced())
                    + "; those holdings are valued at cost.");
        }
        return out;
    }

    private JsonNode recentOrders(JsonNode args, ChatContext ctx) {
        int limit = clamp(args.path("limit").asInt(DEFAULT_ORDERS), 1, MAX_ORDERS);
        String status = args.hasNonNull("status") ? args.get("status").asText().trim().toUpperCase() : null;
        List<OrderHistoryEntry> orders = accounts.getOrderHistory(ctx.accountId(), ctx.tokenAccountId(),
                status == null || status.isEmpty() ? null : status, null, null);
        ArrayNode rows = JSON.createArrayNode();
        orders.stream()
                .sorted(Comparator.comparing(OrderHistoryEntry::getCreatedOn,
                        Comparator.nullsLast(Comparator.reverseOrder())))
                .limit(limit)
                .forEach(o -> {
                    ObjectNode row = rows.addObject();
                    row.put("symbol", o.getSymbol());
                    row.put("side", String.valueOf(o.getSide()));
                    row.put("quantity", o.getQuantity());
                    row.put("limitPrice", o.getPrice());
                    row.put("executedPrice", o.getExecutedPrice());
                    row.put("status", String.valueOf(o.getStatus()));
                    row.put("placedAt", String.valueOf(o.getCreatedOn()));
                    if (o.getReason() != null) {
                        row.put("reason", o.getReason());
                    }
                });
        ObjectNode out = JSON.createObjectNode();
        out.set("orders", rows);
        return out;
    }

    private JsonNode marketOverview() {
        ArrayNode rows = JSON.createArrayNode();
        for (MarketQuoteResponse q : market.latestQuotes()) {
            ObjectNode row = rows.addObject();
            row.put("symbol", q.getSymbol());
            row.put("name", q.getName());
            row.put("price", q.getPrice());
            row.put("change", q.getChange());
            row.put("changePercent", q.getChangePercent());
            row.put("marketState", q.getMarketState());
            row.put("stale", Boolean.TRUE.equals(q.getStale()));
        }
        ObjectNode out = JSON.createObjectNode();
        out.set("instruments", rows);
        return out;
    }

    private JsonNode priceStats(JsonNode args) {
        String symbol = symbol(args);
        String range = args.hasNonNull("range") ? args.get("range").asText().trim().toLowerCase() : DEFAULT_RANGE;
        if (!RANGES.contains(range)) {
            return error("range must be one of " + String.join(", ", RANGES.stream().sorted().toList()));
        }
        List<CandleResponse> history = candles.candles(symbol, "1d", range);
        List<Double> closes = history.stream()
                .map(CandleResponse::getClose).filter(c -> c != null).map(BigDecimal::doubleValue).toList();
        if (closes.size() < 2) {
            return error("Not enough price history for " + symbol + " yet.");
        }
        ObjectNode out = JSON.createObjectNode();
        out.put("symbol", symbol);
        out.put("range", range);
        out.set("stats", JSON.valueToTree(PriceStats.summarise(closes)));
        return out;
    }

    private JsonNode outlook(JsonNode args, ChatContext ctx) {
        String symbol = symbol(args);
        LocalDate today = LocalDate.now(MARKET_ZONE);
        // Completed days only: today's candle is a partial one built from ticks and would distort the history.
        List<CandleResponse> history = candles.candles(symbol, "1d", "1y").stream()
                .filter(c -> c.getClose() != null && c.getTime() != null
                        && c.getTime().atZoneSameInstant(MARKET_ZONE).toLocalDate().isBefore(today))
                .toList();
        if (history.size() < Outlook.MIN_OBSERVATIONS) {
            return error("Not enough price history for " + symbol + " yet (" + history.size() + " days).");
        }

        List<MarketQuoteResponse> quotes = market.latestQuotes();
        MarketQuoteResponse quote = quotes.stream().filter(q -> symbol.equals(q.getSymbol())).findFirst().orElse(null);
        double lastClose = history.get(history.size() - 1).getClose().doubleValue();
        double price = quote != null && quote.getPrice() != null ? quote.getPrice().doubleValue() : lastClose;
        Double changeToday = quote == null || quote.getChangePercent() == null ? null : quote.getChangePercent().doubleValue();

        List<Double> closes = history.stream().map(c -> c.getClose().doubleValue()).toList();
        List<Double> highs = history.stream().map(c -> (c.getHigh() == null ? c.getClose() : c.getHigh()).doubleValue()).toList();
        List<Double> lows = history.stream().map(c -> (c.getLow() == null ? c.getClose() : c.getLow()).doubleValue()).toList();
        List<Long> volumes = history.stream().anyMatch(c -> c.getVolume() != null)
                ? history.stream().map(CandleResponse::getVolume).toList() : null;
        List<Double> ticks = market.history(symbol, 120).stream()
                .map(MarketPoint::getPrice).filter(p -> p != null).map(BigDecimal::doubleValue).toList();

        Outlook.Result result = Outlook.analyse(new Outlook.Input(closes, highs, lows, volumes, price, changeToday, ticks,
                marketContext(quotes)));

        ObjectNode out = JSON.createObjectNode();
        out.put("symbol", symbol);
        out.put("price", price);
        out.put("previousClose", lastClose);
        if (changeToday != null) {
            out.put("changePercentToday", changeToday);
        }
        out.set("outlook", JSON.valueToTree(result));
        out.set("yourPosition", position(symbol, ctx));
        return out;
    }

    private static Outlook.MarketContext marketContext(List<MarketQuoteResponse> quotes) {
        List<Double> changes = quotes.stream().map(MarketQuoteResponse::getChangePercent)
                .filter(c -> c != null).map(BigDecimal::doubleValue).toList();
        int advancers = (int) changes.stream().filter(c -> c > 0).count();
        int decliners = (int) changes.stream().filter(c -> c < 0).count();
        Double average = changes.isEmpty() ? null : changes.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        return new Outlook.MarketContext(advancers, decliners, changes.size(), average);
    }

    /** What this customer already holds of the stock and has done with it, so advice can be about them. */
    private JsonNode position(String symbol, ChatContext ctx) {
        ObjectNode out = JSON.createObjectNode();
        PositionResponse held = accounts.getPortfolio(ctx.accountId(), ctx.tokenAccountId()).getHoldings().stream()
                .filter(p -> symbol.equals(p.getSymbol())).findFirst().orElse(null);
        out.put("holds", held != null && held.getQuantity() != null && held.getQuantity() > 0);
        if (held != null) {
            out.put("quantity", held.getQuantity());
            out.put("averageCost", held.getAverageCost());
        }
        ArrayNode orders = out.putArray("recentOrdersInThisStock");
        accounts.getOrderHistory(ctx.accountId(), ctx.tokenAccountId(), null, null, null).stream()
                .filter(o -> symbol.equals(o.getSymbol()))
                .sorted(Comparator.comparing(OrderHistoryEntry::getCreatedOn, Comparator.nullsLast(Comparator.reverseOrder())))
                .limit(3)
                .forEach(o -> {
                    ObjectNode row = orders.addObject();
                    row.put("side", String.valueOf(o.getSide()));
                    row.put("quantity", o.getQuantity());
                    row.put("executedPrice", o.getExecutedPrice());
                    row.put("status", String.valueOf(o.getStatus()));
                    row.put("placedAt", String.valueOf(o.getCreatedOn()));
                });
        return out;
    }

    private JsonNode suggestOrder(JsonNode args, ChatContext ctx) {
        if (ctx.suggestions().size() >= MAX_SUGGESTIONS) {
            return error("At most " + MAX_SUGGESTIONS + " suggestions per answer.");
        }
        String symbol = symbol(args);
        String side = args.path("side").asText("").trim().toUpperCase();
        if (!side.equals("BUY") && !side.equals("SELL")) {
            return error("side must be BUY or SELL");
        }
        int quantity = args.path("quantity").asInt(0);
        if (quantity < 1 || quantity > MAX_SUGGESTED_QUANTITY) {
            return error("quantity must be a whole number from 1 to " + MAX_SUGGESTED_QUANTITY);
        }
        boolean tradable = instruments.findRowBySymbol(symbol).map(InstrumentMapper.InstrumentRow::isActive).orElse(false);
        if (!tradable) {
            return error(symbol + " is not an instrument that can be traded.");
        }
        if (side.equals("SELL")) {
            int held = accounts.getPortfolio(ctx.accountId(), ctx.tokenAccountId()).getHoldings().stream()
                    .filter(p -> symbol.equals(p.getSymbol()))
                    .map(PositionResponse::getQuantity).filter(q -> q != null).findFirst().orElse(0);
            if (quantity > held) {
                return error("The user holds " + held + " of " + symbol + ", so cannot sell " + quantity + ".");
            }
        }
        String reason = args.path("reason").asText("").replaceAll("\\p{Cntrl}", " ").trim();
        if (reason.length() > 300) {
            reason = reason.substring(0, 300);
        }
        ctx.suggestions().add(new OrderSuggestion(symbol, side, quantity, reason));
        ObjectNode out = JSON.createObjectNode();
        out.put("recorded", true);
        out.put("note", "The user will see a button to open the order form pre-filled. Nothing has been placed.");
        return out;
    }

    // ---- helpers

    private Map<String, BigDecimal> latestPrices() {
        Map<String, BigDecimal> prices = new HashMap<>();
        for (MarketQuoteResponse quote : market.latestQuotes()) {
            if (quote.getSymbol() != null && quote.getPrice() != null) {
                prices.put(quote.getSymbol(), quote.getPrice());
            }
        }
        return prices;
    }

    private static String symbol(JsonNode args) {
        return args.path("symbol").asText("").trim().toUpperCase();
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static ObjectNode error(String message) {
        return JSON.createObjectNode().put("error", message);
    }

    // ---- schema builder

    private static ToolSpec spec(String name, String description, ToolSchema schema) {
        return new ToolSpec(name, description, schema.build());
    }

    private static ToolSchema schema() {
        return ToolSchema.object();
    }
}
