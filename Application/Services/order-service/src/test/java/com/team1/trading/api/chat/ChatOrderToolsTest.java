package com.team1.trading.api.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.team1.trading.api.advice.AdviceService;
import com.team1.trading.api.advice.AdviceViews;
import com.team1.trading.api.advice.AdviceViews.Signal;
import com.team1.trading.api.advice.AnalysisQueries;
import com.team1.trading.api.advice.SignalSource;
import com.team1.trading.api.chat.ChatAction.ConditionalOrderProposal;
import com.team1.trading.api.chat.ChatTools.ChatContext;
import com.team1.trading.api.conditional.ConditionalOrderQueries;
import com.team1.trading.api.conditional.PendingOrderResponse;
import com.team1.trading.api.dto.MarketQuoteResponse;
import com.team1.trading.api.dto.OrderStatusResponse;
import com.team1.trading.api.dto.PortfolioResponse;
import com.team1.trading.api.dto.PositionResponse;
import com.team1.trading.api.service.AccountService;
import com.team1.trading.api.service.MarketService;
import com.team1.trading.api.service.OrderService;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class ChatOrderToolsTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final LocalDate AS_OF = LocalDate.of(2026, 10, 6);

    @Mock
    private OrderService orders;
    @Mock
    private ConditionalOrderQueries conditionalOrders;
    @Mock
    private AnalysisQueries analysis;
    @Mock
    private AdviceService advice;
    @Mock
    private AccountService accounts;
    @Mock
    private MarketService market;

    private ChatOrderTools tools;
    private ChatContext context;

    @BeforeEach
    void setUp() {
        tools = new ChatOrderTools(orders, conditionalOrders, analysis, advice, accounts, market);
        context = new ChatContext(1L, 1L, new ArrayList<>());
        MarketQuoteResponse tcs = new MarketQuoteResponse();
        tcs.setSymbol("TCS");
        tcs.setName("Tata Consultancy Services");
        tcs.setPrice(new BigDecimal("3600.00"));
        lenient().when(market.latestQuotes()).thenReturn(List.of(tcs));
        lenient().when(conditionalOrders.pending(1L)).thenReturn(List.of());
    }

    private JsonNode run(String tool, String argsJson) throws Exception {
        return tools.execute(tool, JSON.readTree(argsJson), context);
    }

    private static Signal signal(String symbol, String suggestion) {
        return new Signal(symbol, symbol + " Ltd", List.of(SignalSource.HOLDING), 10, BigDecimal.TEN, "OK", suggestion,
                "HIGH", BigDecimal.valueOf(70), suggestion + " (high confidence)", List.of("Uptrend: ..."), null, AS_OF,
                false, new AdviceViews.Prediction(AS_OF.plusDays(1), AS_OF, BigDecimal.TEN, BigDecimal.TEN,
                BigDecimal.ONE, BigDecimal.TEN, BigDecimal.ONE, BigDecimal.TEN, new BigDecimal("0.52"), BigDecimal.ZERO));
    }

    @Test
    @DisplayName("The five tools are offered and none takes an account")
    void specs() {
        assertThat(tools.specs()).extracting(LlmClient.ToolSpec::name).containsExactly("get_order_status",
                "get_conditional_orders", "propose_conditional_order", "get_analysis", "get_daily_predictions");
        tools.specs().forEach(s -> assertThat(s.parameters().path("properties").has("accountId")).isFalse());
    }

    @Test
    @DisplayName("Order status is read with the token's account, so another customer's order is refused by the service")
    void orderStatus() throws Exception {
        given(orders.getOrder("ORD-1", 1L)).willReturn(new OrderStatusResponse("ORD-1", 1L, "TCS", OrderSide.BUY, 2,
                new BigDecimal("3650"), null, OrderStatus.PENDING, null, LocalDateTime.of(2026, 10, 7, 9, 0), null));

        JsonNode out = run("get_order_status", "{\"orderId\":\"ORD-1\"}");

        assertThat(out.path("status").asText()).isEqualTo("PENDING");
        assertThat(out.path("createdOn").asText()).isEqualTo("2026-10-07T09:00:00");
        verify(orders).getOrder("ORD-1", 1L);
        assertThat(run("get_order_status", "{}").path("error").asText()).contains("orderId");
    }

    @Test
    @DisplayName("Waiting conditional orders are listed for the customer only")
    void waiting() throws Exception {
        given(conditionalOrders.pending(1L)).willReturn(List.of(new PendingOrderResponse("ORD-1", "TCS", OrderSide.BUY,
                2, new BigDecimal("3650"), "PRICE_AT_OR_BELOW", "when the price falls to 3500.00 or lower",
                new BigDecimal("3500"), null, null, null, null, null, LocalDateTime.of(2026, 11, 6, 9, 0),
                LocalDateTime.of(2026, 10, 7, 9, 0))));

        JsonNode out = run("get_conditional_orders", "{}");

        assertThat(out.path("waiting").get(0).path("condition").asText()).contains("3500.00");
        assertThat(out.path("limit").asInt()).isEqualTo(OrderService.MAX_PENDING_CONDITIONAL);
    }

    @Test
    @DisplayName("A sensible conditional order is recorded as a proposal and nothing is placed")
    void proposeRecordsOnly() throws Exception {
        JsonNode out = run("propose_conditional_order", """
                {"symbol":"tcs","side":"BUY","quantity":2,"limitPrice":3510,"conditionType":"PRICE_AT_OR_BELOW",
                 "triggerPrice":3500,"reason":"Buy the dip to the 50-day average"}""");

        assertThat(out.path("recorded").asBoolean()).isTrue();
        ConditionalOrderProposal proposal = context.conditionalOrderProposals().get(0);
        assertThat(proposal.symbol()).isEqualTo("TCS");
        assertThat(proposal.limitPrice()).isEqualByComparingTo("3510.00");
        assertThat(proposal.expiresInDays()).isEqualTo(30);
        assertThat(proposal.condition()).isEqualTo("when the price falls to 3500.00 or lower");
        assertThat(proposal.currentPrice()).isEqualByComparingTo("3600.00");
        org.mockito.Mockito.verifyNoInteractions(orders);
    }

    @Test
    @DisplayName("Proposals that would not work are refused with the reason")
    void proposeRefusals() throws Exception {
        String base = "{\"symbol\":\"TCS\",\"side\":\"BUY\",\"quantity\":2,\"limitPrice\":3510,"
                + "\"conditionType\":\"PRICE_AT_OR_BELOW\",\"triggerPrice\":3500,\"reason\":\"x\"";

        assertThat(run("propose_conditional_order", base.replace("TCS", "NOPE") + "}").path("error").asText())
                .contains("not an instrument");
        assertThat(run("propose_conditional_order", base.replace("3510", "3400") + "}").path("error").asText())
                .contains("at or above the trigger");
        assertThat(run("propose_conditional_order", base.replace("3500", "35") + "}").path("error").asText())
                .contains("too far from the current price");
        assertThat(run("propose_conditional_order",
                base.replace("PRICE_AT_OR_BELOW", "MA_CROSS_ABOVE") + ",\"shortWindow\":20,\"longWindow\":5}")
                .path("error").asText()).contains("shortWindow < longWindow");
        assertThat(run("propose_conditional_order",
                base.replace("PRICE_AT_OR_BELOW", "MA_CROSS_ABOVE") + ",\"shortWindow\":0,\"longWindow\":5}")
                .path("error").asText()).contains("1 <= shortWindow");
        assertThat(run("propose_conditional_order", base + ",\"expiresInDays\":400}").path("error").asText())
                .contains("expiresInDays");

        given(accounts.getPortfolio(1L, 1L)).willReturn(new PortfolioResponse(1L,
                List.of(new PositionResponse(1L, "TCS", 1, BigDecimal.TEN, BigDecimal.ZERO)), List.of()));
        String sell = base.replace("BUY", "SELL").replace("3510", "3490") + "}";
        assertThat(run("propose_conditional_order", sell).path("error").asText()).contains("holds 1");

        assertThat(context.conditionalOrderProposals()).isEmpty();
    }

    @Test
    @DisplayName("A crossover proposal carries its windows and a readable condition")
    void proposeCrossover() throws Exception {
        run("propose_conditional_order", """
                {"symbol":"TCS","side":"BUY","quantity":1,"limitPrice":3700,"conditionType":"MA_CROSS_ABOVE",
                 "shortWindow":5,"longWindow":20,"expiresInDays":7,"reason":"Trend turning up"}""");

        ConditionalOrderProposal p = context.conditionalOrderProposals().get(0);
        assertThat(p.shortWindow()).isEqualTo(5);
        assertThat(p.triggerPrice()).isNull();
        assertThat(p.condition()).isEqualTo("when the 5-quote average crosses above the 20-quote average");

        given(accounts.getPortfolio(1L, 1L)).willReturn(new PortfolioResponse(1L,
                List.of(new PositionResponse(1L, "TCS", 5, BigDecimal.TEN, BigDecimal.ZERO)), List.of()));
        run("propose_conditional_order", """
                {"symbol":"TCS","side":"SELL","quantity":1,"limitPrice":3500,"conditionType":"MA_CROSS_BELOW",
                 "shortWindow":1,"longWindow":20,"reason":"Exit if it loses its average"}""");
        assertThat(context.conditionalOrderProposals().get(1).condition())
                .isEqualTo("when the price crosses below the 20-quote average");
    }

    @Test
    @DisplayName("Analysis for one symbol, or the strongest ideas with counts, always with the disclaimer")
    void analysisTool() throws Exception {
        given(analysis.find("TCS")).willReturn(Optional.of(signal("TCS", "BUY")));
        JsonNode one = run("get_analysis", "{\"symbol\":\"TCS\"}");
        assertThat(one.path("suggestion").asText()).isEqualTo("BUY");
        assertThat(one.path("asOf").asText()).isEqualTo("2026-10-06");
        assertThat(one.path("disclaimer").asText()).contains("not a personal recommendation");

        given(analysis.all()).willReturn(Map.of("TCS", signal("TCS", "BUY"), "ITC", signal("ITC", "SELL")));
        given(analysis.ranked("BUY", 5)).willReturn(List.of(signal("TCS", "BUY")));
        given(analysis.ranked("SELL", 5)).willReturn(List.of(signal("ITC", "SELL")));
        JsonNode market = run("get_analysis", "{}");
        assertThat(market.path("strongestBuy").get(0).path("symbol").asText()).isEqualTo("TCS");
        assertThat(market.path("counts").path("SELL").asInt()).isEqualTo(1);

        given(analysis.find("NOPE")).willReturn(Optional.empty());
        assertThat(run("get_analysis", "{\"symbol\":\"NOPE\"}").path("error").asText()).contains("No analysis");
    }

    @Test
    @DisplayName("Predictions for one symbol's history, or for what the customer holds and watches")
    void predictionsTool() throws Exception {
        given(analysis.predictionsFor("TCS", 3)).willReturn(List.of(signal("TCS", "BUY").prediction()));
        JsonNode one = run("get_daily_predictions", "{\"symbol\":\"TCS\",\"limit\":3}");
        assertThat(one.path("predictions").get(0).path("forDate").asText()).isEqualTo("2026-10-07");

        given(advice.forAccount(1L)).willReturn(new AdviceViews.Advice(1L, "m", "rules", "d", null, AS_OF, false,
                List.of(signal("TCS", "BUY")), new AdviceViews.Ideas(List.of(), List.of())));
        JsonNode mine = run("get_daily_predictions", "{}");
        assertThat(mine.path("predictions").get(0).path("symbol").asText()).isEqualTo("TCS");
        assertThat(mine.path("predictions").get(0).path("prediction").path("probUp").asDouble()).isEqualTo(0.52);
    }
}
