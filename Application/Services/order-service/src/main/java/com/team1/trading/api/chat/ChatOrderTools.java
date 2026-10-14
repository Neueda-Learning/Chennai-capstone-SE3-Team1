package com.team1.trading.api.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.team1.trading.api.advice.AdviceService;
import com.team1.trading.api.advice.AdviceViews.Advice;
import com.team1.trading.api.advice.AdviceViews.Prediction;
import com.team1.trading.api.advice.AdviceViews.Signal;
import com.team1.trading.api.advice.AnalysisQueries;
import com.team1.trading.api.chat.ChatAction.ConditionalOrderProposal;
import com.team1.trading.api.chat.ChatTools.ChatContext;
import com.team1.trading.api.chat.LlmClient.ToolSpec;
import com.team1.trading.api.conditional.ConditionText;
import com.team1.trading.api.conditional.ConditionalOrderQueries;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.dto.OrderStatusResponse;
import com.team1.trading.api.dto.PositionResponse;
import com.team1.trading.api.service.AccountService;
import com.team1.trading.api.service.MarketService;
import com.team1.trading.api.service.OrderService;
import com.team1.trading.domain.entity.types.ConditionType;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * What the assistant can do with orders and with the ETL's analysis.
 *
 * It can read an order's status, the customer's waiting conditional orders, the published analysis and the
 * daily predictions. It cannot place anything: propose_conditional_order records a proposal that the screen
 * shows as a card, and the customer's click, through POST /api/v1/orders/conditional with their own token,
 * is what places it. As everywhere in the assistant, the account comes from the verified token, never from
 * an argument.
 */
@Component
public class ChatOrderTools {

    public static final String GET_ORDER_STATUS = "get_order_status";
    public static final String GET_CONDITIONAL_ORDERS = "get_conditional_orders";
    public static final String PROPOSE_CONDITIONAL_ORDER = "propose_conditional_order";
    public static final String GET_ANALYSIS = "get_analysis";
    public static final String GET_DAILY_PREDICTIONS = "get_daily_predictions";

    static final int MAX_PROPOSALS = 2;
    static final int MAX_QUANTITY = 10_000;
    static final int MAX_WINDOW = 200;
    static final int DEFAULT_EXPIRY_DAYS = 30;
    static final int MAX_EXPIRY_DAYS = 90;
    static final int MAX_RANKED = 10;
    static final int MAX_PREDICTION_HISTORY = 10;
    /** A price further than this from today's, either way, is almost certainly a typo. */
    static final double MIN_PRICE_RATIO = 0.2;
    static final double MAX_PRICE_RATIO = 5.0;

    private static final ObjectMapper JSON = JsonMapper.builder().findAndAddModules()
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();

    private final OrderService orders;
    private final ConditionalOrderQueries conditionalOrders;
    private final AnalysisQueries analysis;
    private final AdviceService advice;
    private final AccountService accounts;
    private final MarketService market;

    public ChatOrderTools(OrderService orders, ConditionalOrderQueries conditionalOrders, AnalysisQueries analysis,
                          AdviceService advice, AccountService accounts, MarketService market) {
        this.orders = orders;
        this.conditionalOrders = conditionalOrders;
        this.analysis = analysis;
        this.advice = advice;
        this.accounts = accounts;
        this.market = market;
    }

    public List<ToolSpec> specs() {
        return List.of(
                new ToolSpec(GET_ORDER_STATUS,
                        "Where one order stands: status (PENDING while a conditional order waits, NEW once sent, then "
                                + "FILLED, REJECTED or CANCELLED), executed price, rejection reason, and for a conditional "
                                + "order its condition, when it was last checked and why it was released. Use the order id "
                                + "from get_recent_orders or get_conditional_orders, for example ORD-1f2e....",
                        ToolSchema.object().prop("orderId", "STRING", "The order id").required("orderId").build()),
                new ToolSpec(GET_CONDITIONAL_ORDERS,
                        "The customer's conditional orders that are still waiting: what each waits for, the order "
                                + "it will place, when it was last checked and when it expires. Call it before proposing "
                                + "one, to avoid a duplicate, and when asked about pending or automated orders.",
                        ToolSchema.object().build()),
                new ToolSpec(PROPOSE_CONDITIONAL_ORDER,
                        "Offer the customer a conditional order: an order held in the book and checked every minute, "
                                + "placed automatically when its condition is met. This does NOT place it: they see a card "
                                + "and decide. Conditions: PRICE_AT_OR_ABOVE or PRICE_AT_OR_BELOW with triggerPrice; "
                                + "MA_CROSS_ABOVE or MA_CROSS_BELOW with shortWindow and longWindow (counted in live quotes, "
                                + "about one a minute); BOLLINGER_BELOW_LOWER or BOLLINGER_ABOVE_UPPER with longWindow and "
                                + "bandWidth (standard deviations). limitPrice is the worst price they accept when it runs: "
                                + "for a BUY at or above the trigger, for a SELL at or below it. At most " + MAX_PROPOSALS
                                + " per answer.",
                        ToolSchema.object()
                                .prop("symbol", "STRING", "The stock symbol").required("symbol")
                                .prop("side", "STRING", "BUY or SELL").required("side")
                                .prop("quantity", "INTEGER", "Number of shares").required("quantity")
                                .prop("limitPrice", "NUMBER", "Limit price in rupees for the order once released")
                                .required("limitPrice")
                                .prop("conditionType", "STRING", "PRICE_AT_OR_ABOVE, PRICE_AT_OR_BELOW, MA_CROSS_ABOVE, "
                                        + "MA_CROSS_BELOW, BOLLINGER_BELOW_LOWER or BOLLINGER_ABOVE_UPPER")
                                .required("conditionType")
                                .prop("triggerPrice", "NUMBER", "For a PRICE_ condition: the level in rupees")
                                .prop("shortWindow", "INTEGER", "For MA_CROSS_: quotes in the short average, 1 to 199; "
                                        + "1 means the price itself crossing the long average")
                                .prop("longWindow", "INTEGER", "For MA_CROSS_ and BOLLINGER_: quotes in the long average or "
                                        + "band, up to " + MAX_WINDOW)
                                .prop("bandWidth", "NUMBER", "For BOLLINGER_: standard deviations, 0.5 to 4")
                                .prop("expiresInDays", "INTEGER", "Days it may wait, 1 to " + MAX_EXPIRY_DAYS
                                        + " (default " + DEFAULT_EXPIRY_DAYS + ")")
                                .prop("reason", "STRING", "One sentence on why").required("reason").build()),
                new ToolSpec(GET_ANALYSIS,
                        "The ETL analysis service's published view: for one stock, its BUY, SELL or HOLD suggestion with "
                                + "confidence, score, the reasons behind it (trend, momentum, RSI), its indicators and the "
                                + "date of the data; without a symbol, the strongest BUY and SELL suggestions in the market "
                                + "and how many of each there are. Use it for what to buy or sell and for the dashboard's "
                                + "ideas. Say when the data is stale.",
                        ToolSchema.object()
                                .prop("symbol", "STRING", "Optional stock symbol")
                                .prop("limit", "INTEGER", "Without a symbol: how many of each, 1 to " + MAX_RANKED
                                        + " (default 5)").build()),
                new ToolSpec(GET_DAILY_PREDICTIONS,
                        "The ETL service's next-session predictions: expected close, 68% and 90% ranges and the chance of "
                                + "an up session (kept between 40% and 60%). With a symbol, its recent predictions, newest "
                                + "first; without, the latest one for each stock the customer holds or watches.",
                        ToolSchema.object()
                                .prop("symbol", "STRING", "Optional stock symbol")
                                .prop("limit", "INTEGER", "With a symbol: how many sessions back, 1 to "
                                        + MAX_PREDICTION_HISTORY + " (default 5)").build()));
    }

    public boolean handles(String name) {
        return GET_ORDER_STATUS.equals(name) || GET_CONDITIONAL_ORDERS.equals(name)
                || PROPOSE_CONDITIONAL_ORDER.equals(name) || GET_ANALYSIS.equals(name)
                || GET_DAILY_PREDICTIONS.equals(name);
    }

    public JsonNode execute(String name, JsonNode args, ChatContext ctx) {
        return switch (name) {
            case GET_ORDER_STATUS -> orderStatus(args, ctx);
            case GET_CONDITIONAL_ORDERS -> conditionalOrders(ctx);
            case PROPOSE_CONDITIONAL_ORDER -> propose(args, ctx);
            case GET_ANALYSIS -> analysis(args);
            case GET_DAILY_PREDICTIONS -> predictions(args, ctx);
            default -> error("Unknown tool " + name);
        };
    }

    // ---- orders

    private JsonNode orderStatus(JsonNode args, ChatContext ctx) {
        String orderId = args.path("orderId").asText("").trim();
        if (orderId.isEmpty()) {
            return error("orderId is required");
        }
        OrderStatusResponse status = orders.getOrder(orderId, ctx.tokenAccountId());
        return JSON.valueToTree(status);
    }

    private JsonNode conditionalOrders(ChatContext ctx) {
        ObjectNode out = JSON.createObjectNode();
        out.set("waiting", JSON.valueToTree(conditionalOrders.pending(ctx.accountId())));
        out.put("limit", OrderService.MAX_PENDING_CONDITIONAL);
        out.put("note", "Each is checked against the latest live quotes once a minute and placed when its condition "
                + "is met; until then it is PENDING and can be cancelled.");
        return out;
    }

    private JsonNode propose(JsonNode args, ChatContext ctx) {
        if (ctx.conditionalOrderProposals().size() >= MAX_PROPOSALS) {
            return error("At most " + MAX_PROPOSALS + " conditional order proposals per answer.");
        }
        String symbol = args.path("symbol").asText("").trim().toUpperCase(Locale.ROOT);
        Optional<MarketQuoteResponse> quote = market.latestQuotes().stream()
                .filter(q -> symbol.equals(q.getSymbol())).findFirst();
        if (quote.isEmpty()) {
            return error(symbol + " is not an instrument that can be traded.");
        }
        BigDecimal current = quote.get().getPrice();
        String side = args.path("side").asText("").trim().toUpperCase(Locale.ROOT);
        if (!side.equals("BUY") && !side.equals("SELL")) {
            return error("side must be BUY or SELL");
        }
        int quantity = args.path("quantity").asInt(0);
        if (quantity < 1 || quantity > MAX_QUANTITY) {
            return error("quantity must be a whole number from 1 to " + MAX_QUANTITY);
        }
        ConditionType type;
        try {
            type = ConditionType.valueOf(args.path("conditionType").asText("").trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return error("conditionType must be one of " + List.of(ConditionType.values()));
        }
        BigDecimal limit = decimal(args, "limitPrice");
        String bad = priceProblem("limitPrice", limit, current);
        if (bad != null) {
            return error(bad);
        }

        BigDecimal trigger = null;
        Integer shortWindow = null;
        Integer longWindow = null;
        BigDecimal bandWidth = null;
        if (type.isPriceLevel()) {
            trigger = decimal(args, "triggerPrice");
            bad = priceProblem("triggerPrice", trigger, current);
            if (bad != null) {
                return error(bad);
            }
            if (side.equals("BUY") && limit.compareTo(trigger) < 0) {
                return error("For a BUY the limit price should be at or above the trigger, or the order is likely to be "
                        + "rejected the moment it is released.");
            }
            if (side.equals("SELL") && limit.compareTo(trigger) > 0) {
                return error("For a SELL the limit price should be at or below the trigger, or the order is likely to be "
                        + "rejected the moment it is released.");
            }
        } else if (type.isCrossover()) {
            shortWindow = args.path("shortWindow").asInt(0);
            longWindow = args.path("longWindow").asInt(0);
            if (shortWindow < 1 || longWindow <= shortWindow || longWindow < 2 || longWindow > MAX_WINDOW) {
                return error("A crossover needs 1 <= shortWindow < longWindow <= " + MAX_WINDOW);
            }
        } else {
            longWindow = args.path("longWindow").asInt(0);
            bandWidth = decimal(args, "bandWidth");
            if (longWindow < 2 || longWindow > MAX_WINDOW || bandWidth == null
                    || bandWidth.compareTo(new BigDecimal("0.5")) < 0 || bandWidth.compareTo(new BigDecimal("4")) > 0) {
                return error("A band condition needs longWindow from 2 to " + MAX_WINDOW + " and bandWidth from 0.5 to 4");
            }
        }
        int days = args.hasNonNull("expiresInDays") ? args.get("expiresInDays").asInt(0) : DEFAULT_EXPIRY_DAYS;
        if (days < 1 || days > MAX_EXPIRY_DAYS) {
            return error("expiresInDays must be from 1 to " + MAX_EXPIRY_DAYS);
        }

        if (side.equals("SELL")) {
            int held = accounts.getPortfolio(ctx.accountId(), ctx.tokenAccountId()).getHoldings().stream()
                    .filter(p -> symbol.equals(p.getSymbol())).map(PositionResponse::getQuantity)
                    .filter(q -> q != null).findFirst().orElse(0);
            if (quantity > held) {
                return error("The customer holds " + held + " of " + symbol + ", so cannot sell " + quantity + ".");
            }
        }
        if (conditionalOrders.pending(ctx.accountId()).size() + ctx.conditionalOrderProposals().size()
                >= OrderService.MAX_PENDING_CONDITIONAL) {
            return error("The customer already has " + OrderService.MAX_PENDING_CONDITIONAL
                    + " conditional orders waiting; one must be cancelled first.");
        }

        String reason = args.path("reason").asText("").replaceAll("\\p{Cntrl}", " ").trim();
        if (reason.length() > 300) {
            reason = reason.substring(0, 300);
        }
        String condition = ConditionText.describe(type, trigger, shortWindow, longWindow, bandWidth);
        ctx.conditionalOrderProposals().add(new ConditionalOrderProposal(symbol, side, quantity,
                limit.setScale(2, java.math.RoundingMode.HALF_UP), type.name(),
                trigger == null ? null : trigger.setScale(2, java.math.RoundingMode.HALF_UP),
                shortWindow, longWindow, bandWidth, days, condition, reason, current));

        ObjectNode out = JSON.createObjectNode();
        out.put("recorded", true);
        out.put("willPlace", side + " " + quantity + " " + symbol + " at a limit of " + limit + ", " + condition);
        out.put("note", "The customer will see a card with a button. Nothing has been placed until they press it.");
        return out;
    }

    // ---- analysis

    private JsonNode analysis(JsonNode args) {
        String symbol = args.path("symbol").asText("").trim();
        if (!symbol.isEmpty()) {
            Optional<Signal> one = analysis.find(symbol);
            if (one.isEmpty()) {
                return error("No analysis has been published for " + symbol.toUpperCase(Locale.ROOT)
                        + " yet. It appears after the next analysis run.");
            }
            return withDisclaimer(JSON.valueToTree(one.get()));
        }
        int limit = clamp(args.path("limit").asInt(5), 1, MAX_RANKED);
        Map<String, Signal> all = analysis.all();
        if (all.isEmpty()) {
            return error("No analysis has been published yet. It is produced by the ETL analysis job.");
        }
        ObjectNode out = JSON.createObjectNode();
        out.set("strongestBuy", JSON.valueToTree(analysis.ranked("BUY", limit)));
        out.set("strongestSell", JSON.valueToTree(analysis.ranked("SELL", limit)));
        ObjectNode counts = out.putObject("counts");
        for (String s : List.of("BUY", "HOLD", "SELL")) {
            counts.put(s, all.values().stream().filter(v -> s.equals(v.suggestion())).count());
        }
        java.time.LocalDate asOf = all.values().stream().map(Signal::asOf).filter(d -> d != null)
                .max(java.util.Comparator.naturalOrder()).orElse(null);
        out.put("dataAsOf", String.valueOf(asOf));
        out.put("stale", analysis.isStale(asOf));
        out.put("methodology", AnalysisQueries.METHODOLOGY);
        return withDisclaimer(out);
    }

    private JsonNode predictions(JsonNode args, ChatContext ctx) {
        String symbol = args.path("symbol").asText("").trim();
        ObjectNode out = JSON.createObjectNode();
        if (!symbol.isEmpty()) {
            int limit = clamp(args.path("limit").asInt(5), 1, MAX_PREDICTION_HISTORY);
            List<Prediction> history = analysis.predictionsFor(symbol, limit);
            if (history.isEmpty()) {
                return error("No predictions have been published for " + symbol.toUpperCase(Locale.ROOT) + " yet.");
            }
            out.put("symbol", symbol.toUpperCase(Locale.ROOT));
            out.set("predictions", JSON.valueToTree(history));
        } else {
            Advice mine = advice.forAccount(ctx.accountId());
            ArrayNode rows = out.putArray("predictions");
            for (Signal signal : mine.signals()) {
                ObjectNode row = rows.addObject();
                row.put("symbol", signal.symbol());
                row.set("sources", JSON.valueToTree(signal.sources()));
                if (signal.prediction() == null) {
                    row.put("note", "No prediction published");
                } else {
                    row.set("prediction", JSON.valueToTree(signal.prediction()));
                }
            }
            if (rows.isEmpty()) {
                out.put("note", "The customer holds and watches nothing yet; ask about a symbol instead.");
            }
        }
        out.put("howToRead", "predictedClose is the central estimate for forDate; about two sessions in three close "
                + "inside low68-high68 and nine in ten inside low90-high90. probUp is kept between 0.40 and 0.60.");
        return withDisclaimer(out);
    }

    // ---- helpers

    private static ObjectNode withDisclaimer(JsonNode node) {
        ObjectNode out = node.isObject() ? (ObjectNode) node : JSON.createObjectNode().set("data", node);
        out.put("disclaimer", AnalysisQueries.DISCLAIMER);
        return out;
    }

    private static String priceProblem(String field, BigDecimal value, BigDecimal current) {
        if (value == null || value.signum() <= 0) {
            return field + " must be a positive number of rupees";
        }
        if (current != null && current.signum() > 0) {
            double ratio = value.doubleValue() / current.doubleValue();
            if (ratio < MIN_PRICE_RATIO || ratio > MAX_PRICE_RATIO) {
                return field + " " + value + " is too far from the current price " + current + " to be sensible";
            }
        }
        return null;
    }

    private static BigDecimal decimal(JsonNode args, String field) {
        JsonNode node = args.get(field);
        return node == null || !node.isNumber() ? null : node.decimalValue();
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static ObjectNode error(String message) {
        return JSON.createObjectNode().put("error", message);
    }
}
