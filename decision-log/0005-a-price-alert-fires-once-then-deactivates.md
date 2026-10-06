# 0005 A price alert fires once when the threshold is first crossed, then deactivates until the customer re-arms it

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-06 |
| Decided by | drafted by SE ahead of the Monday scope review with the instructor |

## Context

Watchlists consumes `market-data` and evaluates every quote against the active thresholds for that symbol. "Crossed" has three plausible meanings and the brief leaves the choice to the team: "An alert can deactivate itself, wait for the customer to reset it, or fire on every quote past the level. The third choice sends a customer forty messages in a minute, and it sends them through code somebody else on your team is responsible for." The brief also fixes a second requirement: "a customer looking at an alert that says nothing has no idea whether it fired", so the alert's state has to be visible on every option. The channel the message is delivered through is already decided — through Notifications (see [0006](0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md)) which resolves it through Preferences (see [0003](0003-preferences-owns-contact-details-other-modules-reference-them.md)).

## Options considered

| Option | For | Against |
|---|---|---|
| Fire on every quote past the level | Simplest consumer code, no state transition in the alert row | The Watchlists brief rejects this by name; a symbol oscillating around the level sends dozens of messages in a minute; floods Notifications and runs its row cap down for the customer |
| Fire once, auto-deactivate, customer re-arms the alert through the API | Bounded message volume per crossing — exactly one; the customer's intent is explicit on re-arm; the state transition is readable in the UI | Needs an `alert.state` column; needs a UI affordance to re-enable; a customer who wanted repeating alerts gets exactly one |
| Fire once, auto-reset when the price moves back through the level (hysteresis) | No manual re-arm; cleaner from a user story perspective | A noisy symbol oscillating around the level produces as many messages as option 1; "moved back" is ambiguous (reset band? exact level?) and ends up being a second number the customer has to set |

## Decision

Option 2. On a quote that crosses the threshold in the alert's direction, the Watchlists consumer updates `price_alerts` with `WHERE alert_id = ? AND state = 'ARMED'`, treats zero rows affected as "already fired" (the same guarded-transition pattern the Trade Executor uses on `orders`), hands the triggered alert to the Notifications delivery interface, and ignores subsequent quotes for that alert until the customer sets `state = 'ARMED'` through the API. Option 1 is ruled out by the brief; option 3 reduces to option 1 under common oscillation and introduces an ambiguous second parameter the brief did not ask for.

## Consequences

The `price_alerts` table carries a `state` column (`ARMED`, `FIRED`, `DISABLED`) and the Angular UI has a "re-arm" action beside any `FIRED` alert. The consumer's hot-path lookup can skip any alert that is not `ARMED`, which is cheap and keeps the per-quote decision under control for the volume `market-data` carries. The customer gets exactly one notification per crossing — the brief accepts this trade explicitly ("send a customer forty messages in a minute" is the behaviour this rejects). An alert whose delivery through Notifications raises stays in `FIRED` state regardless and the delivery outcome is visible on the alert itself (see [0004](0004-notifications-holds-messages-as-pending-channel-when-no-preference-is-stored.md) for how Notifications records the outcome and [0006](0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md) for the return value of the delivery call). This decision does not add a retry — the customer re-arms if they want the alert back on.
