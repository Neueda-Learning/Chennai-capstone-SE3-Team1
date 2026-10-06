# Team 1 — Sprint 10 scope and backlog

Day-one artifact for SEC3-587. It states what Team 1 will build by Friday 2026-10-09, what it has decided not to build, the routes it proposes to expose, the order the work is done in, and the backlog with acceptance criteria for all four modules. The Java seams between modules are in [`integration-seams.md`](integration-seams.md); the reasoning behind the structural choices is in [`decision-log/`](../../decision-log/).

## 1. Scope for Friday

Four packages inside the Trade REST API (`Application/Services/order-service`, base package `com.team1.trading.api`), per [`decision-log/0001`](../../decision-log/0001-extension-modules-live-as-packages-in-the-trade-rest-api.md).

| Module | Package | Depends on | We will build |
|---|---|---|---|
| Customer Preferences | `...api.preferences` | nothing | Per-customer record (default account, alert channel); read/write routes for the Angular settings screen; `PreferenceResolver` Java interface; default account applied at next sign-in; persistence across restart |
| Customer Notifications | `...api.notifications` | Preferences | `trade-events` consumer (`ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`) in group `notification-service`; channel resolved through `PreferenceResolver` and recorded on the row; one real outbound channel (email); notification ledger with `PENDING_CHANNEL` / `QUEUED` / `SENT` / `FAILED`; history route and Angular inbox; `NotificationDelivery` Java interface; idempotency on `eventId` |
| Watchlists and Price Alerts | `...api.watchlists` | Notifications | Watchlists and instruments; price alerts (threshold + direction); `market-data` consumer in group `watchlist-service`; fire-once alert state machine; hand-off to `NotificationDelivery`; live prices and alert/delivery state in Angular |
| Portfolio and P&L | `...api.portfolio` | nothing | Positions, cost basis, market value and unrealised/realised P&L from `portfolio-service` (already consuming `market-data`); routes brought into line with `contracts/portfolio-api.yaml` |

### Decided not to build

| Item | Module | Why |
|---|---|---|
| Preference history, revert, change-event publishing | Preferences | Out of scope in the brief; nothing downstream needs it |
| Multiple contact points per channel; `channel_contact_override` routes | Preferences | Column exists ([`0003`](../../decision-log/0003-preferences-owns-contact-details-other-modules-reference-them.md)) but no route sets it this sprint |
| Digest batching, read receipts, sophisticated retry | Notifications | Out of scope in the brief; the 60 s `PENDING_CHANNEL` scanner is the only retry |
| SMS and push providers | Notifications | One real channel is the criterion; email is built. SMS and PUSH are valid preference values but have no sender, so those notifications stay recorded in the ledger and are not sent |
| Percentage-move alerts, browser push, per-delivery alert history | Watchlists | Out of scope in the brief |
| Alert auto-reset / repeating alerts | Watchlists | Rejected in [`0005`](../../decision-log/0005-a-price-alert-fires-once-then-deactivates.md) |
| HTTP routes for resolver or delivery | Preferences, Notifications | Rejected in [`0006`](../../decision-log/0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md); this is a security decision, not a time saving |
| Separate deployables per module | all | Rejected in [`0001`](../../decision-log/0001-extension-modules-live-as-packages-in-the-trade-rest-api.md) |

### Starting point in the repository

- Notifications is partly present: a DB-polling notification path exists, but it does not consume `trade-events`, has no `eventId` idempotency, no preference lookup and no recorded channel. It is rebuilt around the consumer rather than extended.
- Portfolio is live (`MarketDataListener`, group `portfolio-service`) but is served at `/api/v1/accounts/{id}/portfolio` with a response shape that differs from `contracts/portfolio-api.yaml`. Closing that gap is the Portfolio work.
- Preferences and Watchlists have no code.

## 2. Proposed routes

Every route sits behind the standard bearer-token verifier, takes the account from the path, and refuses with HTTP 403 `{errorCode: "ACC-403", message}` unless the token's `accountId` claim matches that path account. Authorisation is never taken from the request body. Errors use the platform `{errorCode, message}` envelope. Internal seams are **not** in this table because they are not routes.

### Preferences (no contract supplied — proposed)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/v1/accounts/{accountId}/preferences` | Read the customer's preferences | `404 PRF-404` when none stored; the settings screen treats this as "not set yet" |
| PUT | `/api/v1/accounts/{accountId}/preferences` | Create or replace `{defaultAccountId, channel}` | `channel` ∈ `EMAIL`/`SMS`/`PUSH`; `defaultAccountId` must belong to the same customer, else `PRF-422` |

### Notifications (no contract supplied — proposed)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/v1/accounts/{accountId}/notifications` | Notification history, newest first | `limit` and `before` cursor; returns status and channel kind, never the stored address. This path already exists in `AccountController` and is served by `NotificationMapper` from `orders`/`order_history`/`wallet_transfers`; the Notifications module takes over the implementation behind the same path so the Angular inbox keeps working, and the old query is deleted |

### Watchlists and alerts (no contract supplied — proposed)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/accounts/{accountId}/watchlists` | List watchlists with instruments and live prices |
| POST | `/api/v1/accounts/{accountId}/watchlists` | Create a watchlist |
| DELETE | `/api/v1/accounts/{accountId}/watchlists/{watchlistId}` | Delete a watchlist and its instruments |
| POST | `/api/v1/accounts/{accountId}/watchlists/{watchlistId}/instruments` | Add a symbol (validated against reference data, read-only) |
| DELETE | `/api/v1/accounts/{accountId}/watchlists/{watchlistId}/instruments/{symbol}` | Remove a symbol |
| GET | `/api/v1/accounts/{accountId}/alerts` | List alerts with `state` and `deliveryState` |
| POST | `/api/v1/accounts/{accountId}/alerts` | Create an alert `{symbol, threshold, direction}`; per-account cap enforced (`WLT-429`) |
| PATCH | `/api/v1/accounts/{accountId}/alerts/{alertId}` | Re-arm (`state = ARMED`) or disable (`state = DISABLED`); `FIRED` cannot be set by a caller |
| DELETE | `/api/v1/accounts/{accountId}/alerts/{alertId}` | Delete an alert |

### Portfolio (contract supplied)

Implemented to `contracts/portfolio-api.yaml`: `GET /api/v1/portfolio/{accountId}`, `/positions`, `/pnl`, `/health`. The account is the path `accountId`, checked against the token claim. The existing `/api/v1/accounts/{id}/portfolio` route is kept until the Angular client has moved.

OpenAPI files for the three proposed route sets are written before the code for each module and committed beside it.

## 3. Order of work

The chain, not a person per module, sets the order. Preferences unblocks Notifications; Notifications unblocks Watchlists; Portfolio never blocks anyone. Team 1 therefore works the chain front to back and puts the independent module on whoever is waiting.

| Day | Chain | Parallel |
|---|---|---|
| Day 1 (Tuesday 2026-10-06) | Read briefs together; ADRs 0001–0006; seams fixed ([`integration-seams.md`](integration-seams.md)); this backlog; instructor confirmation. Preferences OpenAPI, table migration, resolver skeleton compiling | Portfolio route gap analysis against `portfolio-api.yaml` |
| Day 2 | Preferences routes + `PreferenceResolver` real implementation + settings screen. Notifications OpenAPI and table migration written against the compiled interface | Portfolio contract routes |
| Day 3 | Notifications consumer, ledger, idempotency, email channel, scanner, history route. Watchlists OpenAPI, tables and CRUD routes against the already-fixed `NotificationDelivery` interface | Portfolio tests and Angular alignment |
| Day 4 (Friday 2026-10-09) | Watchlists `market-data` consumer and alert state machine wired to real `NotificationDelivery`; end-to-end chain; combined OWASP review closed out; freeze, outstanding-items table with owners, showcase rehearsal where every member walks every module | — |

Dependencies are honoured by the interface, not by waiting for the whole module: Notifications starts once `PreferenceResolver` compiles and answers; Watchlists CRUD starts before Notifications is finished because the delivery call is only needed by the consumer.

## 4. Backlog

Story IDs are local to this document (PRF, NTF, WLT, PFL, INT, SEC, DOC). Each is a Jira story or sub-task under SEC3-586 and carries the acceptance criteria below.

### Preferences

| ID | Story | Acceptance criteria |
|---|---|---|
| PRF-1 | OpenAPI for preferences routes | Spec committed before implementation; covers `GET`/`PUT`, `ACC-403`, `PRF-404`, `PRF-422` |
| PRF-2 | `customer_preferences` migration | Columns per [`0003`](../../decision-log/0003-preferences-owns-contact-details-other-modules-reference-them.md); contains no email or phone copy except nullable `channel_contact_override`; survives app restart |
| PRF-3 | Read and write routes | Token `accountId` must match path or `ACC-403`; `defaultAccountId` validated as the customer's own; integration tests for own/other account |
| PRF-4 | `PreferenceResolver` implementation | Matches seam 1 exactly; reads `auth_db.users` at call time, no cache; `Optional.empty()` for no row; `PreferenceResolutionException` on read failure; address never logged |
| PRF-5 | Angular settings screen | Customer can view and change channel and default account; "not set yet" state handled |
| PRF-6 | Default account at sign-in | After sign-in the Angular app selects the stored default account without user action |

### Notifications

| ID | Story | Acceptance criteria |
|---|---|---|
| NTF-1 | OpenAPI for history route | Spec committed before implementation |
| NTF-2 | `notifications` migration | Columns and `UNIQUE(event_id)` per [`0004`](../../decision-log/0004-notifications-holds-messages-as-pending-channel-when-no-preference-is-stored.md) |
| NTF-3 | `trade-events` consumer | Group `notification-service`, manual ack; handles the three outcome event types; ignores others; offset committed after the row is durably written |
| NTF-4 | Channel resolution | Calls `PreferenceResolver`; resolved channel recorded on the row; `Optional.empty()` or exception → `PENDING_CHANNEL`; no hardcoded fallback channel |
| NTF-5 | Idempotency | Replaying the same `eventId` produces no second row and no second message — shown in a live replay |
| NTF-6 | Email channel | At least one real outbound message sent to the resolved address; fixed destination types only; no credentials or card numbers in message bodies |
| NTF-7 | Ledger state | `QUEUED`, `SENT`, `FAILED` tracked separately from the Kafka offset |
| NTF-8 | `PENDING_CHANNEL` scanner | 60 s task re-resolves and promotes; shares the `event_id`/`deliveryId` key; 10 000-row per-account cap |
| NTF-9 | History route | `ACC-403` on mismatch; returns status and channel kind, not the address |
| NTF-10 | `NotificationDelivery` implementation | Matches seam 2; `deliveryId` idempotent; `QUEUED`/`PENDING_CHANNEL`/`REJECTED`; `NotificationDeliveryException` only for infrastructure failure |
| NTF-11 | Angular inbox | Customer sees history regardless of channel state |

### Watchlists and alerts

| ID | Story | Acceptance criteria |
|---|---|---|
| WLT-1 | OpenAPI for watchlist and alert routes | Spec committed before implementation |
| WLT-2 | Tables and indexes | `watchlists`, instruments, `price_alerts(state ARMED/FIRED/DISABLED)`; index on `(symbol, state)` so the per-quote lookup does not scan; reference data referenced, not copied |
| WLT-3 | Watchlist and instrument routes | `ACC-403` on mismatch on every route; unknown symbol rejected |
| WLT-4 | Alert routes | Create/list/re-arm/disable/delete; per-account cap; `FIRED` not settable by callers |
| WLT-5 | `market-data` consumer | Group `watchlist-service`; does not touch `orders` or `trade-events`; evaluates only `ARMED` alerts for the quote's symbol |
| WLT-6 | Fire-once transition | Guarded `UPDATE ... WHERE state = 'ARMED'` per [`0005`](../../decision-log/0005-a-price-alert-fires-once-then-deactivates.md); zero rows means already fired and nothing is sent |
| WLT-7 | Delivery hand-off | Calls `NotificationDelivery.deliver`; records `deliveryState` per the seam 2 table; failure leaves the alert `FIRED` with `DELIVERY_FAILED`; nothing is only logged |
| WLT-8 | Angular watchlists | Live prices, alert state and delivery state visible; re-arm action beside `FIRED` alerts |

### Portfolio and P&L

| ID | Story | Acceptance criteria |
|---|---|---|
| PFL-1 | Gap analysis | Differences between current routes/shape and `portfolio-api.yaml` listed and closed |
| PFL-2 | Contract routes | `/api/v1/portfolio/{accountId}` and sub-routes return the contract shape with `ACC-403` enforcement |
| PFL-3 | P&L correctness | Cost basis, market value, unrealised and realised P&L verified against hand-computed cases |
| PFL-4 | Angular alignment | Portfolio screen reads the contract routes |

### Cross-cutting

| ID | Story | Acceptance criteria |
|---|---|---|
| INT-1 | End-to-end chain | With live quotes and Kafka: place an order, receive a notification on the stored channel; cross an alert threshold, receive the alert on the same channel; replay produces no duplicates |
| INT-2 | Module boundary check | A grep over each package finds imports of other modules only through the interfaces in the seams document |
| SEC-1 | Combined OWASP Top Ten review | One document from `security-review/TEMPLATE.md`, all ten categories, findings addressed or listed with an owner |
| DOC-1 | Decision log | At least six entries in the template shape (0001–0006 present) |
| TST-1 | Tests | Unit and integration tests per module including authorisation-failure cases for every route |
| TEAM-1 | Showcase readiness | Each member can walk every module unaided |

## 5. What is brought to the instructor

1. This document: build list, not-build list, proposed routes.
2. [`integration-seams.md`](integration-seams.md): the two Java interfaces and the four package names.
3. `decision-log/0001`–`0006`.

Confirmation is recorded as a comment on SEC3-587 by the instructor; the day-one acceptance criterion is met when that comment exists.
