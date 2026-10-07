# 0013 The assistant proposes conditional orders; the customer's click places them

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-07 |
| Decided by | drafted while adding the assistant's order and analysis tools; to be confirmed with the product owner |

## Context

The assistant gained tools to make conditional orders, read order status and read the analysis and daily predictions. Every tool it already had that changes something (`suggest_order`, `propose_alert`, `propose_watchlist`) records a proposal the screen shows as a card, and only the customer's click, through the app's authenticated calls, changes anything. `ChatAction` states the reason: it "makes 'ask for confirmation' a rule of the system rather than a request to the model". A conditional order spends money later, with nobody watching.

## Options considered

| Option | For | Against |
|---|---|---|
| The tool places the conditional order directly with `OrderService.placeConditionalOrder` | One step for the customer | A model's mistake, a misread number or text injected into a tool result becomes an order; the only safeguard is the prompt |
| The tool records a proposal; the card's button calls `POST /api/v1/orders/conditional` with the customer's token | Same rule as every other assistant action; the customer sees the exact order, condition, limit and expiry before anything exists; the server runs every check on the click | One extra click |

## Decision

Propose and confirm. `propose_conditional_order` validates in code before recording anything: an active instrument, a limit and trigger within 0.2x to 5x of the current price, a BUY limit at or above its trigger and a SELL limit at or below it (so the order would not be rejected the moment it is released), sane windows and band widths, enough held to sell, room under the 25-order cap, at most two proposals per answer. The card shows the order in words; the click sends a fresh idempotency key. The read tools (`get_order_status`, `get_conditional_orders`, `get_analysis`, `get_daily_predictions`) take the account from the verified token, never from an argument, and the analysis and prediction results carry the disclaimer.

## Consequences

The assistant can never say it placed an order, and the system prompt says so. If the product owner later wants one-step placement, the change is in `ChatOrderTools` and this entry; the order path itself would not change.
