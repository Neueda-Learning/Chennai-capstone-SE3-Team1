package com.team1.trading.api.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.team1.trading.api.chat.ChatAction.AlertProposal;
import com.team1.trading.api.chat.ChatAction.NavigationLink;
import com.team1.trading.api.chat.ChatAction.WatchlistProposal;
import com.team1.trading.api.chat.ChatTools.ChatContext;
import com.team1.trading.api.chat.LlmClient.ToolSpec;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.mapper.InstrumentMapper;
import com.team1.trading.api.notifications.Direction;
import com.team1.trading.api.service.MarketService;
import com.team1.trading.api.watchlists.AlertResponse;
import com.team1.trading.api.watchlists.AlertService;
import com.team1.trading.api.watchlists.AlertState;
import com.team1.trading.api.watchlists.WatchlistResponse;
import com.team1.trading.api.watchlists.WatchlistService;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * What the assistant can do with the customer's alerts and watchlists, and with moving them around the app.
 *
 * It can read both. It cannot change either: propose_alert and propose_watchlist record a proposal that the
 * screen shows as a card with a confirm button, and the customer's click, through the app's own authenticated
 * calls, is what creates anything. Every proposal is checked here first, in code, so the card the customer sees
 * is already one that would be accepted: real instruments, sensible levels, no duplicates, within the limits.
 * As elsewhere, the account is never an argument; it comes from the verified token.
 */
@Component
public class ChatWorkspaceTools {

    public static final String GET_ALERTS = "get_alerts";
    public static final String GET_WATCHLISTS = "get_watchlists";
    public static final String PROPOSE_ALERT = "propose_alert";
    public static final String PROPOSE_WATCHLIST = "propose_watchlist";
    public static final String SUGGEST_NAVIGATION = "suggest_navigation";

    static final int MAX_ALERT_PROPOSALS = 3;
    static final int MAX_WATCHLIST_PROPOSALS = 2;
    static final int MAX_LINKS = 3;
    static final int MAX_SYMBOLS = 25;
    static final int MAX_NAME = 60;
    static final int MAX_TEXT = 300;
    /** An alert level further than this from today's price, either way, is almost certainly a typo. */
    static final double MIN_PRICE_RATIO = 0.2;
    static final double MAX_PRICE_RATIO = 5.0;

    private static final ObjectMapper JSON = new ObjectMapper();

    /** The pages of the app the assistant may send a customer to. Anything else is refused. */
    enum Destination {
        DASHBOARD("/app/dashboard", "Dashboard"),
        PORTFOLIO("/app/portfolio", "Portfolio"),
        MARKET_AND_TRADE("/app/orders", "Market & Trade"),
        BLOTTER("/app/blotter", "Blotter"),
        WATCHLISTS("/app/watchlists", "Watchlists"),
        ACCOUNT("/app/account", "My Account"),
        SETTINGS("/app/settings", "Settings"),
        BANK_ACCOUNT("/app/bank-accounts", "Bank Account Details");

        final String path;
        final String title;

        Destination(String path, String title) {
            this.path = path;
            this.title = title;
        }
    }

    private final AlertService alerts;
    private final WatchlistService watchlists;
    private final MarketService market;
    private final InstrumentMapper instruments;

    public ChatWorkspaceTools(AlertService alerts, WatchlistService watchlists, MarketService market,
                              InstrumentMapper instruments) {
        this.alerts = alerts;
        this.watchlists = watchlists;
        this.market = market;
        this.instruments = instruments;
    }

    public List<ToolSpec> specs() {
        return List.of(
                spec(GET_ALERTS,
                        "The customer's price alerts: stock, level, which way it waits, whether it is watching, "
                                + "triggered or off, and how far the stock now is from the level. Call it before proposing "
                                + "an alert, to avoid a duplicate, and when asked about their alerts.",
                        ToolSchema.object()),
                spec(GET_WATCHLISTS,
                        "The customer's watchlists and the stocks on each, with live prices. Call it before proposing a "
                                + "watchlist, to reuse or extend one they already have, and when asked about their watchlists.",
                        ToolSchema.object()),
                spec(PROPOSE_ALERT,
                        "Offer the customer a price alert. This does NOT create it: they see a card with a button and "
                                + "decide. The direction is worked out for you (a level above the price waits for a rise, "
                                + "below waits for a fall). At most " + MAX_ALERT_PROPOSALS + " per answer.",
                        ToolSchema.object()
                                .prop("symbol", "STRING", "The stock symbol, for example TCS").required("symbol")
                                .prop("threshold", "NUMBER", "The price level in rupees").required("threshold")
                                .prop("reason", "STRING", "One sentence on why this level is useful").required("reason")),
                spec(PROPOSE_WATCHLIST,
                        "Offer the customer a watchlist of stocks, new, or additions to one they already have if the name "
                                + "matches. This does NOT create anything: they see a card with a button and decide. Use only "
                                + "symbols of instruments that can be traded (see get_market_overview). At most "
                                + MAX_WATCHLIST_PROPOSALS + " per answer.",
                        ToolSchema.object()
                                .prop("name", "STRING", "A short plain name for the watchlist, for example Banks").required("name")
                                .arrayOf("symbols", "STRING", "Stock symbols to put on it, up to " + MAX_SYMBOLS).required("symbols")
                                .prop("reason", "STRING", "One sentence on what the list is for").required("reason")),
                spec(SUGGEST_NAVIGATION,
                        "Give the customer a 'go there' button to a page of the app. Use it whenever they ask where "
                                + "something is or how to do something in the app, or when sending them to a page would "
                                + "help. At most " + MAX_LINKS + " per answer.",
                        ToolSchema.object()
                                .prop("destination", "STRING", "One of: DASHBOARD, PORTFOLIO, MARKET_AND_TRADE, BLOTTER, "
                                        + "WATCHLISTS, ACCOUNT, SETTINGS, BANK_ACCOUNT").required("destination")
                                .prop("label", "STRING", "The button's text, for example 'Open your watchlists'")
                                .prop("symbol", "STRING", "For MARKET_AND_TRADE: the stock to open. For WATCHLISTS: a stock "
                                        + "whose price-alert chart to open")
                                .prop("side", "STRING", "For MARKET_AND_TRADE with a symbol: BUY or SELL, to pre-fill the form")
                                .prop("quantity", "INTEGER", "For MARKET_AND_TRADE with a symbol and side: shares to pre-fill")
                                .prop("search", "STRING", "For BLOTTER: text to search the order history for, for example a symbol")));
    }

    public boolean handles(String name) {
        return GET_ALERTS.equals(name) || GET_WATCHLISTS.equals(name) || PROPOSE_ALERT.equals(name)
                || PROPOSE_WATCHLIST.equals(name) || SUGGEST_NAVIGATION.equals(name);
    }

    public JsonNode execute(String name, JsonNode args, ChatContext ctx) {
        return switch (name) {
            case GET_ALERTS -> getAlerts(ctx);
            case GET_WATCHLISTS -> getWatchlists(ctx);
            case PROPOSE_ALERT -> proposeAlert(args, ctx);
            case PROPOSE_WATCHLIST -> proposeWatchlist(args, ctx);
            case SUGGEST_NAVIGATION -> suggestNavigation(args, ctx);
            default -> error("Unknown tool " + name);
        };
    }

    // ---- reading

    private JsonNode getAlerts(ChatContext ctx) {
        Map<String, BigDecimal> prices = prices();
        ArrayNode rows = JSON.createArrayNode();
        for (AlertResponse alert : alerts.list(ctx.accountId())) {
            ObjectNode row = rows.addObject();
            row.put("symbol", alert.symbol());
            row.put("level", alert.threshold());
            row.put("waitsFor", alert.direction() == Direction.ABOVE ? "a rise to or above the level" : "a fall to or below the level");
            row.put("state", alert.state().name());
            BigDecimal price = prices.get(alert.symbol());
            if (price != null) {
                row.put("currentPrice", price);
                if (alert.state() == AlertState.ARMED && price.signum() > 0) {
                    row.put("percentAway", alert.threshold().subtract(price).abs().multiply(BigDecimal.valueOf(100))
                            .divide(price, 1, RoundingMode.HALF_UP));
                }
            }
            if (alert.state() == AlertState.FIRED) {
                row.put("firedAt", String.valueOf(alert.firedAt()));
                row.put("firedPrice", alert.firedPrice());
            }
        }
        ObjectNode out = JSON.createObjectNode();
        out.set("alerts", rows);
        out.put("limit", AlertService.MAX_ALERTS);
        return out;
    }

    private JsonNode getWatchlists(ChatContext ctx) {
        ArrayNode rows = JSON.createArrayNode();
        for (WatchlistResponse list : watchlists.list(ctx.accountId())) {
            ObjectNode row = rows.addObject();
            row.put("name", list.name());
            ArrayNode stocks = row.putArray("instruments");
            list.instruments().forEach(entry -> {
                ObjectNode stock = stocks.addObject();
                stock.put("symbol", entry.symbol());
                stock.put("name", entry.name());
                stock.put("price", entry.price());
                stock.put("changePercent", entry.changePercent());
            });
        }
        ObjectNode out = JSON.createObjectNode();
        out.set("watchlists", rows);
        out.put("limitPerAccount", WatchlistService.MAX_WATCHLISTS);
        out.put("limitPerList", WatchlistService.MAX_INSTRUMENTS);
        return out;
    }

    // ---- proposals

    private JsonNode proposeAlert(JsonNode args, ChatContext ctx) {
        if (ctx.alertProposals().size() >= MAX_ALERT_PROPOSALS) {
            return error("At most " + MAX_ALERT_PROPOSALS + " alert proposals per answer.");
        }
        String symbol = upper(args.path("symbol").asText(""));
        if (!isTradable(symbol)) {
            return error(symbol.isEmpty() ? "A symbol is needed." : symbol + " is not an instrument that can be traded.");
        }
        BigDecimal threshold = decimal(args.get("threshold"));
        if (threshold == null || threshold.signum() <= 0) {
            return error("threshold must be a price greater than zero");
        }
        threshold = threshold.setScale(2, RoundingMode.HALF_UP);
        if (threshold.signum() <= 0) {
            return error("threshold must be at least 0.01");
        }
        final BigDecimal level = threshold;
        BigDecimal price = prices().get(symbol);
        if (price == null || price.signum() <= 0) {
            return error("There is no live price for " + symbol + " yet, so an alert level cannot be checked against it.");
        }
        double ratio = threshold.doubleValue() / price.doubleValue();
        if (ratio < MIN_PRICE_RATIO || ratio > MAX_PRICE_RATIO) {
            return error(threshold + " is far from " + symbol + "'s current price of " + price
                    + "; check the level (an alert is normally within a few tens of percent of the price).");
        }
        int comparison = threshold.compareTo(price);
        if (comparison == 0) {
            return error(symbol + " is already trading at " + threshold + ", so there is nothing to wait for.");
        }
        String direction = comparison > 0 ? "ABOVE" : "BELOW";

        List<AlertResponse> existing = alerts.list(ctx.accountId());
        boolean duplicate = existing.stream().anyMatch(a -> a.state() == AlertState.ARMED && a.symbol().equals(symbol)
                && a.direction().name().equals(direction) && a.threshold().compareTo(level) == 0);
        if (duplicate) {
            return error("The customer already has this alert watching.");
        }
        if (existing.size() + ctx.alertProposals().size() >= AlertService.MAX_ALERTS) {
            return error("The customer already has " + existing.size() + " alerts, the most an account can hold ("
                    + AlertService.MAX_ALERTS + "). They would need to delete one first.");
        }
        if (ctx.alertProposals().stream().anyMatch(p -> p.symbol().equals(symbol) && p.threshold().compareTo(level) == 0)) {
            return error("That alert is already proposed in this answer.");
        }

        double percent = Math.round((threshold.doubleValue() - price.doubleValue()) / price.doubleValue() * 1000.0) / 10.0;
        ctx.alertProposals().add(new AlertProposal(symbol, threshold, direction, clean(args.path("reason").asText(""), MAX_TEXT),
                price, percent));
        ObjectNode out = JSON.createObjectNode();
        out.put("recorded", true);
        out.put("direction", direction);
        out.put("percentFromNow", percent);
        out.put("note", "The customer will see a card with a button to set this alert. Nothing has been created.");
        return out;
    }

    private JsonNode proposeWatchlist(JsonNode args, ChatContext ctx) {
        if (ctx.watchlistProposals().size() >= MAX_WATCHLIST_PROPOSALS) {
            return error("At most " + MAX_WATCHLIST_PROPOSALS + " watchlist proposals per answer.");
        }
        String name = clean(args.path("name").asText(""), MAX_NAME);
        if (name.isEmpty()) {
            return error("A watchlist needs a name.");
        }
        JsonNode list = args.get("symbols");
        if (list == null || !list.isArray() || list.isEmpty()) {
            return error("symbols must be a list of at least one stock symbol.");
        }
        Set<String> requested = new LinkedHashSet<>();
        list.forEach(node -> {
            String symbol = upper(node.asText(""));
            if (!symbol.isEmpty()) {
                requested.add(symbol);
            }
        });
        if (requested.isEmpty()) {
            return error("symbols must be a list of at least one stock symbol.");
        }
        if (requested.size() > MAX_SYMBOLS) {
            return error("At most " + MAX_SYMBOLS + " symbols per watchlist proposal; choose the best.");
        }
        List<String> unknown = requested.stream().filter(s -> !isTradable(s)).toList();
        if (!unknown.isEmpty()) {
            ObjectNode out = error("These are not instruments that can be traded: " + String.join(", ", unknown)
                    + ". Use only symbols from get_market_overview.");
            ArrayNode bad = out.putArray("unknownSymbols");
            unknown.forEach(bad::add);
            return out;
        }

        List<WatchlistResponse> existing = watchlists.list(ctx.accountId());
        Optional<WatchlistResponse> same = existing.stream().filter(w -> w.name().equalsIgnoreCase(name)).findFirst();
        WatchlistProposal proposal;
        if (same.isPresent()) {
            Set<String> present = new LinkedHashSet<>();
            same.get().instruments().forEach(entry -> present.add(entry.symbol()));
            List<String> fresh = requested.stream().filter(s -> !present.contains(s)).toList();
            if (fresh.isEmpty()) {
                return error("Every one of those is already on the customer's \"" + same.get().name() + "\" watchlist.");
            }
            if (present.size() + fresh.size() > WatchlistService.MAX_INSTRUMENTS) {
                return error("\"" + same.get().name() + "\" can hold at most " + WatchlistService.MAX_INSTRUMENTS + " instruments.");
            }
            proposal = new WatchlistProposal("ADD", same.get().name(), same.get().id(), fresh, clean(args.path("reason").asText(""), MAX_TEXT));
        } else {
            long creating = ctx.watchlistProposals().stream().filter(p -> "CREATE".equals(p.mode())).count();
            if (existing.size() + creating >= WatchlistService.MAX_WATCHLISTS) {
                return error("The customer already has the most watchlists an account can hold ("
                        + WatchlistService.MAX_WATCHLISTS + "). Offer to add to one of theirs instead.");
            }
            proposal = new WatchlistProposal("CREATE", name, null, List.copyOf(requested), clean(args.path("reason").asText(""), MAX_TEXT));
        }
        final WatchlistProposal chosen = proposal;
        if (ctx.watchlistProposals().stream().anyMatch(p -> p.name().equalsIgnoreCase(chosen.name()))) {
            return error("A watchlist called \"" + chosen.name() + "\" is already proposed in this answer.");
        }
        ctx.watchlistProposals().add(chosen);
        ObjectNode out = JSON.createObjectNode();
        out.put("recorded", true);
        out.put("mode", chosen.mode());
        out.put("symbolCount", chosen.symbols().size());
        out.put("note", "The customer will see a card with a button to " + (chosen.mode().equals("ADD") ? "add these" : "create this watchlist")
                + ". Nothing has been created.");
        return out;
    }

    // ---- navigation

    private JsonNode suggestNavigation(JsonNode args, ChatContext ctx) {
        if (ctx.links().size() >= MAX_LINKS) {
            return error("At most " + MAX_LINKS + " links per answer.");
        }
        Destination destination;
        try {
            destination = Destination.valueOf(upper(args.path("destination").asText("")));
        } catch (IllegalArgumentException e) {
            return error("destination must be one of: " + String.join(", ", java.util.Arrays.stream(Destination.values()).map(Enum::name).toList()));
        }

        Map<String, String> query = new LinkedHashMap<>();
        String symbol = upper(args.path("symbol").asText(""));
        if (!symbol.isEmpty() && (destination == Destination.MARKET_AND_TRADE || destination == Destination.WATCHLISTS)) {
            if (!isTradable(symbol)) {
                return error(symbol + " is not an instrument that can be traded.");
            }
            query.put(destination == Destination.WATCHLISTS ? "alert" : "symbol", symbol);
            if (destination == Destination.MARKET_AND_TRADE) {
                String side = upper(args.path("side").asText(""));
                int quantity = args.path("quantity").asInt(0);
                if (side.equals("BUY") || side.equals("SELL")) {
                    query.put("side", side);
                    if (quantity >= 1 && quantity <= ChatTools.MAX_SUGGESTED_QUANTITY) {
                        query.put("quantity", String.valueOf(quantity));
                    }
                }
            }
        }
        if (destination == Destination.BLOTTER) {
            String search = clean(args.path("search").asText(""), 40);
            if (!search.isEmpty()) {
                query.put("q", search);
            }
        }

        String label = clean(args.path("label").asText(""), MAX_NAME);
        NavigationLink link = new NavigationLink(label.isEmpty() ? "Go to " + destination.title : label, destination.path, query);
        if (ctx.links().stream().anyMatch(l -> l.path().equals(link.path()) && l.query().equals(link.query()))) {
            return error("That link is already offered in this answer.");
        }
        ctx.links().add(link);
        ObjectNode out = JSON.createObjectNode();
        out.put("recorded", true);
        out.put("page", destination.title);
        out.put("note", "The customer will see a button that takes them there.");
        return out;
    }

    // ---- helpers

    private Map<String, BigDecimal> prices() {
        Map<String, BigDecimal> prices = new HashMap<>();
        for (MarketQuoteResponse quote : market.latestQuotes()) {
            if (quote.getSymbol() != null && quote.getPrice() != null) {
                prices.put(quote.getSymbol(), quote.getPrice());
            }
        }
        return prices;
    }

    private boolean isTradable(String symbol) {
        return !symbol.isEmpty() && instruments.findRowBySymbol(symbol).map(InstrumentMapper.InstrumentRow::isActive).orElse(false);
    }

    private static BigDecimal decimal(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        try {
            return node.isNumber() ? node.decimalValue() : new BigDecimal(node.asText("").trim().replace(",", ""));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String upper(String text) {
        return text == null ? "" : text.trim().toUpperCase(Locale.ROOT);
    }

    /** Control characters out, trimmed and cut: text that came from the model is shown to the customer and stored by them. */
    static String clean(String text, int max) {
        String cleaned = text == null ? "" : text.replaceAll("\\p{Cntrl}", " ").trim();
        return cleaned.length() > max ? cleaned.substring(0, max).trim() : cleaned;
    }

    private static ToolSpec spec(String name, String description, ToolSchema schema) {
        return new ToolSpec(name, description, schema.build());
    }

    private static ObjectNode error(String message) {
        return JSON.createObjectNode().put("error", message);
    }
}
