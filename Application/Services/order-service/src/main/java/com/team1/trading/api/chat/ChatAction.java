package com.team1.trading.api.chat;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Things the assistant can put in front of the customer besides words. None of them does anything by
 * itself: each is shown as a card with a button, and only the customer's click, made through the app's
 * own authenticated calls, creates an alert or a watchlist or moves them to another page. That is what
 * makes "ask for confirmation" a rule of the system rather than a request to the model.
 */
public final class ChatAction {

    private ChatAction() {
    }

    /** A price alert the assistant thinks the customer would want. The direction is worked out in code. */
    public record AlertProposal(
            String symbol,
            BigDecimal threshold,
            String direction,
            String reason,
            BigDecimal currentPrice,
            Double percentFromNow) {
    }

    /**
     * A watchlist to create (mode CREATE) or instruments to add to one the customer already has (mode ADD,
     * with its id). {@code symbols} are only ones that exist and are not already on the list.
     */
    public record WatchlistProposal(
            String mode,
            String name,
            String watchlistId,
            List<String> symbols,
            String reason) {
    }

    /**
     * A conditional order the assistant suggests. The customer's click places it through
     * POST /api/v1/orders/conditional with their own token; until then nothing exists. Every field has been
     * checked in code: a real instrument, a sensible limit and trigger, enough held to sell, room under the cap.
     */
    public record ConditionalOrderProposal(
            String symbol,
            String side,
            int quantity,
            BigDecimal limitPrice,
            String conditionType,
            BigDecimal triggerPrice,
            Integer shortWindow,
            Integer longWindow,
            BigDecimal bandWidth,
            int expiresInDays,
            String condition,
            String reason,
            BigDecimal currentPrice) {
    }

    /** A "go there" button: a page in the app, optionally with a stock or a search filled in. */
    public record NavigationLink(String label, String path, Map<String, String> query) {
    }
}
