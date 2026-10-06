# Rotation across the four modules (SEC3-593)

Rule from the brief: someone who first opens the watchlist consumer on Friday afternoon cannot answer a question about it on Friday afternoon. So every member walks at least three of the four modules before Friday, and Friday morning is spent being asked questions cold, not preparing.

Team members are listed as they appear as git authors: Haripriya S, Nadella Roshni, Sai Ethihas Chanda, Samyuktha J, Subhash Krishnasamy. Five people and four modules means one person each session asks the questions. Swap names freely, but keep the two rules: nobody walks the same module twice in the rota, and the Watchlists consumer is walked by three different people before Friday.

## Walk-through sessions

A walk-through is 40 minutes: the walker opens the module's README, follows one request or one message through the code and the tests with the questioner and the previous walker watching, and runs the module's tests. The walker is a person who has not walked that module in an earlier session.

| Session | Preferences | Notifications | Watchlists and Alerts | Portfolio | Asks the questions |
|---|---|---|---|---|---|
| 1. Wednesday 2026-10-07, afternoon | Sai Ethihas Chanda | Nadella Roshni | Subhash Krishnasamy | Samyuktha J | Haripriya S |
| 2. Thursday 2026-10-08, morning | Haripriya S | Sai Ethihas Chanda | Nadella Roshni | Subhash Krishnasamy | Samyuktha J |
| 3. Thursday 2026-10-08, afternoon | Samyuktha J | Haripriya S | Sai Ethihas Chanda | Nadella Roshni | Subhash Krishnasamy |

After session 3 each member has walked three different modules and asked questions once. The Watchlists consumer has been walked by Subhash, Nadella and Sai.

## What each walk covers

Start from the module README in the package (`Application/Services/order-service/src/main/java/com/team1/trading/api/<module>/README.md`), then the seams in [`integration-seams.md`](integration-seams.md).

| Module | Follow this | Run |
|---|---|---|
| Preferences | `PUT /preferences` through `PreferenceController`, `AccessGuard.requireOwner`, `PreferenceService`, `customer_preferences`; then `PreferenceResolver` as the Notifications seam | `PreferenceControllerWebTest`, `DatabasePreferenceResolverTest` |
| Notifications | One `trade-events` message: `TradeEventListener`, the ledger insert guarded by `UNIQUE(event_id)`, channel resolution, `PENDING_CHANNEL`, the dispatcher, `OutboundChannels`; then `NotificationDelivery` for an alert | `NotificationLedgerFlowTest`, `NotificationDeliveryServiceTest` |
| Watchlists and Alerts | One `QUOTE` through `MarketDataAlertListener`, `AlertEvaluator`, the guarded `UPDATE ... WHERE state = 'ARMED'`, `handOver`, `AlertDeliverySweeper` | `AlertEvaluationFlowTest`, `AlertDeliveryThroughNotificationsTest` |
| Portfolio | `MarketDataListener` (group `portfolio-service`), `AccountService.resolve` and the ownership check, the portfolio and orders routes | `ModuleRouteAuthorisationTest` for the five Portfolio routes |

## Questions anyone must be able to answer

Asked cold on Friday, by someone who walked the module in a different session. Answers are in the module README and the decision log.

**Preferences**
- What does the settings screen show before anything is saved, and which status code does that come from? (`404 PRF-404`, treated as "not set yet".)
- Who owns the customer's email address, and why is there no copy in this table? ([`0003`](../../decision-log/0003-preferences-owns-contact-details-other-modules-reference-them.md))
- Why is there no HTTP route for resolving a channel? ([`0006`](../../decision-log/0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md))

**Notifications**
- What happens to a trade event for a customer with no stored channel? (Held as `PENDING_CHANNEL`; the 60 s scanner re-resolves it.)
- What stops the same `trade-events` message producing two notifications? (`UNIQUE(event_id)`; the same `deliveryId` returns the same outcome.)
- What do `PENDING_CHANNEL`, `QUEUED`, `SENT` and `FAILED` each mean, and what does a missing SMTP account look like? (`FAILED`, `EMAIL_NOT_CONFIGURED`.)

**Watchlists and Alerts (the consumer)**
- Which topic and consumer group does the watchlist consumer read, and what must it never read? (`market-data`, group `watchlist-service`; never `trade-events` or `orders`.)
- Which quotes does it skip, and what does it do with the offset when it skips one? (Stale, malformed and non-positive prices; acknowledged.)
- When has a price crossed a threshold? (`>=` for `ABOVE`, `<=` for `BELOW`; [`0010`](../../decision-log/0010-a-crossing-is-reaching-the-threshold-on-a-live-quote-and-an-undelivered-alert-is-recovered-by-a-sweep.md).)
- Two quotes cross the same alert at once; why is only one notification sent? (The guarded `UPDATE ... WHERE state = 'ARMED'` updates zero rows the second time.)
- The service dies between firing the alert and handing it to Notifications. What repairs it, and why is there no duplicate? (`AlertDeliverySweeper` every 60 s re-hands `FIRED` alerts with no delivery state older than 30 s; the `deliveryId` is derived from the alert id and `fired_at`.)
- What does the customer do to be told again? (`PATCH {"state": "ARMED"}`; [`0005`](../../decision-log/0005-a-price-alert-fires-once-then-deactivates.md).)

**Portfolio**
- Which consumer group feeds it, and where is the account ownership checked? (`portfolio-service`; `AccountService.resolve`.)
- Why does the Portfolio route return `ACC-403` and not `AUTH-401` when called with no token in a unit test? (The real `401` comes from `JwtVerificationFilter` in the running app.)

**The whole chain**
- Walk the run in [`e2e-live-run.md`](e2e-live-run.md): which step proves the stored channel drove both notifications?
- Which routes does a customer's token reach, and what is the answer for an `ADMIN` token for a different account? (Only their own account; `ACC-403`, no bypass.)

## Friday 2026-10-09, morning

1. 09:00 The live run, with everyone watching ([`e2e-live-run.md`](e2e-live-run.md)). The run record is filled in from the report.
2. 09:30 Cold questions. Each member is asked two questions from the lists above on modules they walked in different sessions, chosen by another member, and one question on the Watchlists consumer. Nobody reads the README during the question.
3. Record the result below. A question answered wrongly is answered correctly by the person who walked that module, and that module is walked again by the person who missed it before the showcase.

| Member | Questions asked | Answered unaided | Module to revisit |
|---|---|---|---|
| Haripriya S | | | |
| Nadella Roshni | | | |
| Sai Ethihas Chanda | | | |
| Samyuktha J | | | |
| Subhash Krishnasamy | | | |
