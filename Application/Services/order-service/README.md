# Sprint 6 — Trade Order API

## Characterisation tests for the order placement path

Record what the service does now, including the parts you disagree with,
rather than what you think it should do.

They live in one package of their own, named here as the story requires:

```
src/test/java/com/team1/trading/api/characterisation/
```

`OrderPlacementCharacterisationTest` pins the order placement behaviour as
the service exhibits it today. Commit these pins before the change; when a
later change deliberately alters a pinned behaviour, that test is updated in
the **same commit** as the source change and the commit message says so.

### What comes back for an affordable order, field by field

Posting an affordable buy (account 2, `INFY` `BUY` 10 @ `100.00`) answers
HTTP 200 with:

- `orderId`: `ORD-` followed by the 36-character order UUID;
- `status`: `NEW`;
- `message`: `Order accepted`;
- `symbol`: `INFY`, `side`: `BUY`, `quantity`: 10, `price`: `100.00`.

### Which code and status come back for the rejects

- Reused idempotency key: HTTP 409, `errorCode` `ORD-409`, message
  `Duplicate order`. The first post still succeeds; the duplicate writes no
  second row and publishes no second event.
- Unaffordable buy: HTTP 400, `errorCode` `ORD-400`, message
  `Insufficient funds`. No order row is written and no event is published.
- Unknown symbol: HTTP 404, `errorCode` `INS-404`, message
  `Instrument not found`. No order row is written and no event is published.
- Account that is not ACTIVE: HTTP 403, `errorCode` `ACC-403`, message
  `Account not active`. No order row is written and no event is published.

### What is written when an order is accepted

For the accepted order above (account 3, `INFY` `BUY` 5 @ `100.00`):

- order row: `client_id = account_id` (3), `order_type = POSITION`,
  `status = NEW`, the submitted limit price stored, `executed_price` null,
  the idempotency key stored, `external_order_id` null;
- cash: untouched - the wallet balance and its version do not move;
- positions: no `portfolio_positions` row and no `portfolio_holding` row
  appear.

### What is published when an order is accepted

One `ORDER_PLACED` event goes to the `orders` topic, keyed by the account id
(`"2"`), wrapped in the shared five-field envelope (`eventId`, `eventType`,
`eventTime`, `source = trade-api`, `schemaVersion = 1`). The payload carries
the order id, account id, symbol, side, quantity, limit price, idempotency
key and a created-on timestamp. The Kafka template is a mock - the pin is
about what is sent and when, not about a broker.

## Assistant (chat)

`POST /api/v1/accounts/{id}/chat` powers the assistant overlay in the UI. The body is the conversation
so far, `{ "messages": [{ "role": "user" | "assistant", "text": "..." }] }` (at most 20 messages of 1,500
characters; only those two roles are accepted). The answer is `{ "reply": "...", "suggestions": [...] }`.
The contract is `Application/Contracts/api-schemas/chat-api.yaml`.

**How it answers.** The model (Gemini, through `GeminiClient`, behind the provider-neutral `LlmClient`)
is given six tools and decides which to call: `get_account_summary`, `get_recent_orders`,
`get_market_overview`, `get_price_stats`, `get_outlook` and `suggest_order`. Everything numeric (valuation, profit and
loss, weights, concentration, moving averages, RSI, volatility, drawdown) is computed in code
(`PortfolioAnalytics`, `PriceStats`), never by the model.

**Questions about where a stock may go.** `get_outlook` (`Outlook`, `TechnicalIndicators`) is a
statistical reading, not a forecast. From a year of daily prices and volumes, the live quote, recent intraday
prices, how many stocks are up today, and the customer's own position and orders in the stock, it scores seven
signals (trend, momentum from MACD and 20-day change, overbought/oversold stretch from RSI and Bollinger
bands, position in the 52-week range, volume confirmation, market breadth and relative strength, and
intraday drift) into a lean (bullish, bearish, neutral). The indicative chance of an up day starts from the
stock's own up-day record, shrunk towards 50, nudged by the signals and by what followed past days with a
similar RSI, then **kept between 40 and 60 in steps of 5**: next-day direction is close to a coin flip and
simple indicators have a weak record. Confidence is never above moderate. Price ranges come from the stock's
own distribution of daily and five-day moves (empirical 5th to 95th percentile, or a normal estimate with under
60 days), so they say how far it has typically moved, not where it will go. Today's partial candle is excluded
from the history. The prompt requires the assistant to present it as odds and ranges, add general sector
background labelled as such, say what would change the view, never say a price "will" do anything, and refuse
guarantees, price targets and tips. It cannot see news, results or fundamentals, and says so.

**What it can and cannot do.**
- It is read-only. `suggest_order` places nothing: it records a suggestion that the UI shows as a
  "Review in order form" button, which opens the order page pre-filled. The customer places the order.
- The account is never an argument to a tool. It comes from the verified token, so nothing the model
  writes, however it was prompted, can read another customer's data. Ownership is checked before any
  quota or model spend, using the same check as every account route.
- A suggestion is validated in code: a real, active instrument, a whole quantity from 1 to 10,000, and
  never a sale larger than the holding. At most three per answer.
- The standing instructions (`SystemPrompt`) forbid promises of return, price targets, claiming to have
  placed an order, inventing news, and discussing other accounts, and tell it to treat tool output and
  customer text as data, not instructions. It is described to the customer as educational guidance, not advice.
- Each account gets 20 messages per 5 minutes (`chat.rate-limit.*`).
- The audit log line records who asked, how many messages, which tools ran and what was suggested. It
  never records message text or portfolio data.

**Configuration.** The key is the TrustMe secret `LLM_API_KEY` (without it the endpoint answers `CHT-503`
and the service still starts). The rest is in `application.properties`: `chat.models` (tried in order;
the free tier's newer models are sometimes overloaded, so a 503 is retried once and then the next model
is used), `chat.thinking-level` (`low` is much faster; a model that rejects it is asked again without),
`chat.timeout-seconds` and the rate limit. Errors use the normal envelope: `CHT-429` (too many
messages) and `CHT-503` (assistant unavailable).

**Limits to know about.** The free Gemini tier is rate-limited and not fast: expect 5 to 30 seconds for
an answer that needs several data lookups. Conversations are sent to Google to be answered, and on the
free tier Google may use them to improve its products, so use test accounts while developing. The
assistant knows holdings and price history only: no news, fundamentals or sector data.

## Why PostgreSQL and not H2

The placement path is pinned against a real PostgreSQL database because the
`PositionMapper` upserts use the PostgreSQL-only
`INSERT ... ON CONFLICT ... DO UPDATE` syntax, which H2 cannot parse. The
regular unit and integration tests keep using the H2 `schema.sql`; the
characterisation tests load their own Postgres schema from
`src/test/resources/charact-schema.sql` (selected via
`spring.sql.init.schema-locations` in `PostgresCharactDbInitializer`), with
seed data from the shared `data.sql`.

## Build

The characterisation tests run as part of the module's test suite. They need
a local PostgreSQL server (default `localhost:5432`) and the team TrustMe
key file at the repo root (`leapcapstoneteam1-720d03.TM`, overridable through
the `TRUSTME_KEY_FILE` / `CHARACT_DB_NAME` environment variables):

```bash
mvn -f Application/Services/order-service/pom.xml test
```
