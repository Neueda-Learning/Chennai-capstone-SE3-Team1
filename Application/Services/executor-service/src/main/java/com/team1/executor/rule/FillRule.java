package com.team1.executor.rule;

import com.team1.executor.model.QuoteResponse;
import com.team1.trading.domain.entity.Order;
import com.team1.trading.domain.entity.types.OrderSide;

import java.math.BigDecimal;
import java.math.RoundingMode;

public final class FillRule {

    private static final int PRICE_SCALE = 2;
    private static final RoundingMode ROUNDING = RoundingMode.HALF_UP;

    private FillRule() {}

    public static FillRuleResult evaluate(Order order, QuoteResponse quote) {
        if (quote == null || quote.bid() == null || quote.ask() == null) {
            return new FillRuleResult(FillDecision.REJECT, null, "NO_PRICE_AVAILABLE");
        }

        BigDecimal limitPrice = order.getPrice();
        OrderSide side = order.getSide();
        BigDecimal bid = round(quote.bid());
        BigDecimal ask = round(quote.ask());

        if (side == OrderSide.BUY) {
            if (limitPrice.compareTo(ask) >= 0) {
                return new FillRuleResult(FillDecision.FILL, ask, null);
            }
            return new FillRuleResult(FillDecision.REJECT, null, "BUY_LIMIT_BELOW_ASK");
        } else {
            if (limitPrice.compareTo(bid) <= 0) {
                return new FillRuleResult(FillDecision.FILL, bid, null);
            }
            return new FillRuleResult(FillDecision.REJECT, null, "SELL_LIMIT_ABOVE_BID");
        }
    }

    private static BigDecimal round(BigDecimal value) {
        return value.setScale(PRICE_SCALE, ROUNDING);
    }
}