# 0016 Scheduled orders are placed from the stock's chart on Market & Trade, with the condition inferred rather than chosen

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-07 |
| Decided by | requested by the product owner on 2026-10-07 ("no separate page ... instead of a dropdown, make it inferred; click a button to graphically mark a level, on confirmation ask buy or sell; the initial button decides moving-average line or custom level") |

## Context

Conditional orders (0012) were first placed from their own page, then from an "Order type" dropdown on the Market & Trade ticket listing six condition types. A customer had to translate an intention ("buy if it dips to 1,250", "sell if it loses its average") into a condition name and a set of fields. The ticket's chart dialog already lets a customer place a price alert by clicking the chart, with the direction inferred from where the click sits against today's price.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep the dropdown of condition types | Every condition reachable | The customer picks a type before seeing the chart; six names for two intentions; fields appear and disappear by type |
| A separate scheduled-orders page | Room for a full form | Away from the price and the chart the decision is made against; the product owner asked for it to live on Market & Trade |
| Two buttons on the ticket, "At a price level" and "On a moving average", each opening the stock's chart in a scheduling mode; the condition is inferred from the mark and the side | The same click-the-chart gesture as alerts; whether it waits for a rise or a fall is where the level sits; for the average, buy means a cross above and sell a cross below, so only buy or sell is asked; waiting orders drawn on the chart | Bollinger-band conditions are not offered in the UI (still accepted by the API and the assistant) |

## Decision

The third option. The chart dialog swaps its side panel for a scheduled-order panel. **At a price level**: the customer clicks the chart (or types a price, or uses -5/-2/+2/+5%), the panel says whether it waits for a rise or a fall, then asks Buy or Sell, quantity, an optional limit (blank: 2% past the level, as a market order is protected) and how long to wait. **On a moving average**: the chart switches to one-minute candles for the day, because the condition is evaluated on live quotes that arrive about once a minute, and draws the average line (20 quotes by default); Buy places when the price crosses above it, Sell when it crosses below; a faster average can stand in for the price. To express "the price crosses its average", a crossover's short window may now be 1 (migration 034, `Order.holdUntil`, `ConditionSpec`). Waiting orders are listed under the ticket with Cancel, and the selected stock's price-level orders are drawn on its chart. The separate page and its sidebar entry are removed.

## Consequences

Placing a scheduled order is two clicks and a quantity from the chart the customer is already reading. The API is unchanged apart from allowing a short window of 1, so the assistant's proposals and `POST /api/v1/orders/conditional` work as before. Band conditions remain an API capability without a chart gesture; adding one would be a third button that draws the bands.
