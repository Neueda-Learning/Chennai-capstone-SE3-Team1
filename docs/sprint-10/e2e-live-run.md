# End-to-end run on live data (SEC3-593)

The chain under test: a stored channel preference drives a trade notification, and a price alert on a live quote is delivered through Notifications on the same channel. The run uses the real Trade API, the real Kafka broker, the real executor and the real database. Nothing is stubbed. Fixtures belong in the test suites; this run is the demonstration.

`scripts/e2e_live.py` performs the run through the public routes only, so it needs a bearer token and no database credentials. `tests/test_e2e_live.py` tests the script itself against a throwaway HTTP stub; that proves the script reads responses correctly and fails where it should, and it is not the demonstration.

## Before the run

1. The stack must be a build that contains Sprint 10: migrations `026`–`029` applied and the new `order-service` jar. A stack started before those merged returns 404 on `/preferences`, `/notification-history` and `/watchlists`, and the script stops at its first step and says so.
   ```powershell
   .\run-local.ps1 -ResetDb      # rebuilds, applies migrations, starts Kafka, DB, auth :3000, API :8081, executor :8083
   ```
   `run-local.ps1` asks for the TrustMe vault password. Type it at the prompt; do not paste it into a command line or a chat, because a password passed as a process argument is visible in the process list (see the security review, finding on `run-local.ps1`).
2. The script mints nothing itself. `run-local.ps1` writes a one-hour token for account 1 to `logs\local\token.txt`. If it has expired, the script refuses to start and tells you; re-run `run-local.ps1`, or sign in with `--username` and `--password`.
3. The account needs a funded wallet (enough for one BUY of one share at the live price). `scripts/create_test_account.py` creates and funds one.
4. The market poller must be producing quotes, so a non-stale `market_quotes` row exists for at least one symbol.
5. For the `EMAIL` channel only: the vault holds `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM`, and the customer's address in `auth_db.users` is one you can read. Without the SMTP keys the ledger records `FAILED / EMAIL_NOT_CONFIGURED`, which the script reports as a failed step (that is the honest state, not a bug in the script). `PUSH` needs no SMTP and is the default.

## The run

```powershell
python scripts\e2e_live.py                       # PUSH channel, publishes one crossing quote to market-data
python scripts\e2e_live.py --channel EMAIL       # delivered by the vault SMTP account
python scripts\e2e_live.py --real-quote          # publishes nothing; waits for the poller's own quote to cross
python scripts\e2e_live.py --cleanup             # delete the alert afterwards
```

Other options: `--symbol TCS`, `--username U --password P` (or `E2E_PASSWORD`), `--api`, `--auth`, `--bootstrap`, `--kafka-home`, `--timeout SECONDS` (default 150 for each asynchronous step).

The exit status is 0 only when every step passed. The result is printed and written to `logs\local\e2e-report.md` (the `logs` folder is git-ignored; copy the report where the showcase can see it).

## What each step proves

| Step | Proves |
|---|---|
| Trade API serves the Watchlists, Preferences and Notifications routes | The running build is the Sprint 10 build |
| Consumer groups attached to the live broker | `notification-service`, `watchlist-service` and `portfolio-service` are consuming from the real broker (read with `ConsumerGroupCommand`) |
| Store the channel preference; read it back | Preferences persists and returns the choice through its route |
| A live, non-stale quote exists | The demonstration starts from a real quote, not a constant |
| Place a real BUY order | A real order row goes through the Trade API to the `orders` topic and the executor, priced just over the ask so it is not refused |
| The ledger shows the trade outcome; the order was filled; delivered on the channel | The executor's `trade-events` message reached the Notifications consumer, which resolved the stored channel and recorded `ORDER_FILLED` as `SENT` (or `QUEUED` then `SENT` for the dispatcher) |
| Create a price alert | The alert is `ARMED` with the threshold just above the live price |
| Publish a crossing quote to `market-data` (default mode only) | One real-format `QUOTE` envelope reaches the topic that `watchlist-service` consumes |
| The alert fired and was handed to Notifications; the hand-over was accepted | The guarded fire happened once and `NotificationDelivery.deliver` returned `QUEUED` |
| The ledger shows the `PRICE_ALERT` row, delivered on the channel | The alert became a ledger row through the real Notifications service |
| Both notifications used the stored channel | The same preference drove the trade notification and the alert |
| No response carries an address | The history route never returns a stored address (P5, route side) |

## Limits to say out loud at the showcase

- In the default mode the crossing quote is published by the script, in the real `market-data` envelope format, at 0.1% over the latest real price. The poller overwrites it with a real quote within one poll interval. The price used to build it, the order, the executor fill, the ledger rows and the delivery are all real. If the panel wants the quote itself to be the poller's, use `--real-quote`; it waits as long as `--timeout` allows for the market to move to the threshold, which depends on the market.
- `--real-quote` can legitimately time out on a quiet market. That is a failed run, not a pass.
- Nothing here reads Kafka payloads or the log files for an address. The P5 log and Kafka search is a separate manual step: send an `EMAIL` run, then search `logs\local\*.log` and a console consumer on `trade-events` and `market-data` for the address of the test user. Record the result in the security review (P5).
- Replay idempotency on a live broker (re-publishing one `trade-events` message and counting rows) is covered by `NotificationLedgerFlowTest` and `AlertDeliveryThroughNotificationsTest` against the real database layer; the live replay is a manual extra, not part of this script.

## Authorisation and reachability checks that run in the build

These run without the stack and are part of `mvn test` and `ng test`:

- `ModuleRouteAuthorisationTest` (order-service) discovers every `/api/v1/accounts/{...}` route from the running handler mapping, compares it with the 17 expected (12 added by Sprint 10 and 5 Portfolio), and for every route proves another customer's token and an `ADMIN` token for a different account are `ACC-403`, no token is never answered with data, and no service behind the guard is reached. A route added without a sample body or without a place in the expected list fails the test, so a new route cannot ship unchecked.
- `module-reachability.spec.ts` (Angular) proves Portfolio, Watchlists and Settings (which hosts Preferences and Notification History) are routes behind the sign-in guard, loaded to the right pages, linked from the sidebar or profile menu, and that the Settings page asks the Trade API for the signed-in account's preferences and history.

## Run record

Fill this in from `logs\local\e2e-report.md` after the run. Do not enter a result that was not produced by a run.

| Field | Value |
|---|---|
| Date and time | |
| Build (commit or jar timestamp) | |
| Command | |
| Channel | |
| Symbol and live price at start | |
| Order id and fill price | |
| Alert id, threshold, fired price | |
| Result (steps passed / total) | |
| Run by | |
