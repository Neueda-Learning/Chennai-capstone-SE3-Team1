package com.team1.executor;

import com.team1.executor.model.QuoteResponse;
import com.team1.executor.rule.FillDecision;
import com.team1.executor.rule.FillRule;
import com.team1.executor.rule.FillRuleResult;
import com.team1.trading.domain.entity.Order;
import com.team1.trading.domain.entity.types.OrderSide;
import com.team1.trading.domain.entity.types.OrderType;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class FillRuleTest {

    private static final BigDecimal ASK = new BigDecimal("100.05");
    private static final BigDecimal BID = new BigDecimal("99.95");

    private QuoteResponse quote() {
        return new QuoteResponse(
                "ACME", BigDecimal.valueOf(100), BID, ASK, "USD",
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
                "open", false, Instant.now());
    }

    private Order buyOrder(BigDecimal limitPrice) {
        return new Order(1L, 1L, "ACME", OrderType.POSITION, OrderSide.BUY,
                BigDecimal.valueOf(10), limitPrice, "idem-1");
    }

    private Order sellOrder(BigDecimal limitPrice) {
        return new Order(1L, 1L, "ACME", OrderType.POSITION, OrderSide.SELL,
                BigDecimal.valueOf(10), limitPrice, "idem-1");
    }

    @Test
    void buyLimitAtOrAboveAskFillsAtAsk() {
        FillRuleResult result = FillRule.evaluate(buyOrder(new BigDecimal("100.05")), quote());
        assertThat(result.decision()).isEqualTo(FillDecision.FILL);
        assertThat(result.executedPrice()).isEqualByComparingTo(ASK);
        assertThat(result.reason()).isNull();
    }

    @Test
    void buyLimitAboveAskFillsAtAsk() {
        FillRuleResult result = FillRule.evaluate(buyOrder(new BigDecimal("101.00")), quote());
        assertThat(result.decision()).isEqualTo(FillDecision.FILL);
        assertThat(result.executedPrice()).isEqualByComparingTo(ASK);
    }

    @Test
    void buyLimitBelowAskRejects() {
        FillRuleResult result = FillRule.evaluate(buyOrder(new BigDecimal("100.00")), quote());
        assertThat(result.decision()).isEqualTo(FillDecision.REJECT);
        assertThat(result.reason()).isEqualTo("BUY_LIMIT_BELOW_ASK");
        assertThat(result.executedPrice()).isNull();
    }

    @Test
    void sellLimitAtOrBelowBidFillsAtBid() {
        FillRuleResult result = FillRule.evaluate(sellOrder(new BigDecimal("99.95")), quote());
        assertThat(result.decision()).isEqualTo(FillDecision.FILL);
        assertThat(result.executedPrice()).isEqualByComparingTo(BID);
        assertThat(result.reason()).isNull();
    }

    @Test
    void sellLimitBelowBidFillsAtBid() {
        FillRuleResult result = FillRule.evaluate(sellOrder(new BigDecimal("99.00")), quote());
        assertThat(result.decision()).isEqualTo(FillDecision.FILL);
        assertThat(result.executedPrice()).isEqualByComparingTo(BID);
    }

    @Test
    void sellLimitAboveBidRejects() {
        FillRuleResult result = FillRule.evaluate(sellOrder(new BigDecimal("100.00")), quote());
        assertThat(result.decision()).isEqualTo(FillDecision.REJECT);
        assertThat(result.reason()).isEqualTo("SELL_LIMIT_ABOVE_BID");
        assertThat(result.executedPrice()).isNull();
    }

    @Test
    void nullQuoteRejectsWithNoPriceAvailable() {
        FillRuleResult result = FillRule.evaluate(buyOrder(new BigDecimal("100.00")), null);
        assertThat(result.decision()).isEqualTo(FillDecision.REJECT);
        assertThat(result.reason()).isEqualTo("NO_PRICE_AVAILABLE");
    }

    @Test
    void quoteWithMissingBidAskRejects() {
        QuoteResponse badQuote = new QuoteResponse("ACME", BigDecimal.valueOf(100), null, BID, "USD",
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, "open", false, Instant.now());
        FillRuleResult result = FillRule.evaluate(buyOrder(new BigDecimal("100.00")), badQuote);
        assertThat(result.decision()).isEqualTo(FillDecision.REJECT);
        assertThat(result.reason()).isEqualTo("NO_PRICE_AVAILABLE");
    }
}