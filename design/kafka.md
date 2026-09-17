# Kafka: topics, keys, partitions and the quota

Status: our decisions. `contracts/kafka-topics.md` is binding and states the
reasoning; this file records what we did with it, what we chose where the
contract left the choice to us, and what breaks under the alternatives we
rejected.

## The command that creates the topics

```bash
docker compose up -d
bash infra/kafka/create-topics.sh
```

`infra/kafka/create-topics.sh` takes an empty broker to the full six-topic state
in one run, without prompting. It is idempotent (`--if-not-exists`), so running
it against a broker that already has the topics changes nothing and exits zero.
It ends with `--list` and `--describe`, so the run itself is the evidence.

We reset the Kafka data volume more than once a week. Every reset removes every
topic, and every reset is followed by that one command. No topic on our broker
exists because somebody typed a command by hand.

Auto-creation is off: `KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"` in
`docker-compose.yml`. With it on, the first producer to write to a topic nobody
created would silently get one partition and default retention, which is exactly
the failure the `--describe` check is meant to catch. With it off, that producer
gets an error, and an error is actionable.

## Partition counts

| Topic | Partitions | Why this number |
|---|---:|---|
| `orders` | 3 | Three is the ceiling on useful executor concurrency, and we want to demonstrate the ceiling |
| `trade-events` | 3 | Matches `orders`; consumers of a fill are the same population as producers of the order |
| `market-data` | 6 | Highest message rate on the platform, and no consumer of it does database work |

### What three partitions means for us, concretely

`orders` is consumed by exactly one group, `trade-executor`. A consumer group
assigns whole partitions, never fractions of one, so **we can usefully run three
executor instances and no more**. A fourth joins the group, is assigned nothing,
and sits idle burning a container — and it is not a warm standby in any useful
sense either, because if one of the three dies the rebalance would have promoted
an idle member anyway.

That is the number to give at the review: **three**. If we ever need a fourth
instance, the partition count has to go up first, and the next section is why
that is not free.

### What raising the partition count in Sprint 10 costs

Partitions can be increased and never decreased. Increasing them is not
additive: Kafka's default partitioner is `hash(key) % partitionCount`, so
changing the count rehashes every key.

Say we go from 3 to 6 on `orders` while account 42 has two unprocessed messages.
Before the change, `hash(42) % 3` put both on partition 1. After, a new message
for account 42 lands on `hash(42) % 6`, which is partition 1 or partition 4, and
it is a coin toss which. If it lands on partition 4, that message is now in a
different partition from the two still waiting on partition 1, assigned to a
different consumer, with no ordering relationship to them at all. **Account 42's
SELL can be executed before the BUY that funded it.** The per-account ordering
the key was chosen to give us is gone for exactly as long as both partitions
hold unprocessed messages for that account.

Which consumers would notice, from the contract's producer/consumer matrix:

| Consumer | Notices? | What goes wrong |
|---|---|---|
| Trade Executor, on `orders` | **Yes, worst case** | A sell executes before its funding buy. Rule 7 rejects it, so the customer sees a spurious insufficient-holdings rejection on an order that was valid when accepted |
| `portfolio-service`, on `trade-events` | **Yes** | It maintains its own projection from `positionQuantityAfter` and `averageCostAfter`. Those fields are snapshots, not deltas, so applying them out of order leaves the projection holding an older position permanently |
| `strategy-service`, `advice-service` | **Yes** | Both act on the event sequence. A strategy that reads "position went to zero" after "position went to 100" unwinds a position it still holds |
| `notification-service` | Cosmetically | The customer gets the fill notice after the settlement notice. Irritating, not corrupting |
| `analytics-loader` (Python ETL) | **No** | It merges on `source_order_id` and is order-insensitive by construction. This is the only consumer we could repartition under safely |

So if Sprint 10 needs more partitions, the safe procedure is to drain rather
than to resize live: stop the producers, let the group consume to the end of
every partition, then `--alter --partitions`, then restart the producers. The
rehash still happens; what the drain removes is the window where one account has
messages on both sides of it.

## Key choices

`orders` and `trade-events` are keyed by `accountId` as a string. `market-data`
is keyed by `symbol`.

The key is the only thing that decides the partition, and the partition is the
only thing that carries an ordering guarantee. Keying `orders` by `orderId` —
the tempting choice, because it is the unique one — would put every message on
its own partition by hash, spread across all three, with no ordering between any
two of them. Every account would then be subject to the sell-before-buy failure
above, permanently, rather than only during a repartition.

`market-data` is keyed by symbol for the equivalent reason one level down: the
ordering that matters for a quote is per instrument. `watchlist-service` fires
price alerts off this topic, and an alert evaluated against a stale quote
delivered after a fresh one fires on a price that no longer exists.

## The Fauxnance quota

One key, 2000 requests per day, resetting at 00:00 UTC, shared by the two things
in the executor that call Fauxnance: the market-data poller and the fill path.

### How we divide it

| | Requests/day | Why |
|---|---:|---|
| Poller budget | 1500 | Enough for a one-batch poll every 58s |
| Fill-path reserve | 500 | 500 priced orders in a day, far above anything we generate |
| **Total** | **2000** | The whole key |

The split is enforced, not documented. `QuotaLedger` is the single place that
counts what has been spent; `FauxnanceQuoteClient` records every request it
makes, including each retry attempt, and the poller asks the ledger whether it
may spend before it calls. When the poller would push the day's spend past 1500
it skips the cycle and logs. The fill path is never blocked, because a rejected
order is a worse outcome than a missing quote tick.

### The arithmetic

```
requests/day = ceil(symbols / 25) x ceil(86400 / interval)
```

The batch endpoint `GET /quotes?symbols=A,B,C` takes at most 25 symbols and
costs **one request whatever the symbol count**, which is the whole reason the
numbers below work.

| Interval | Requests/24h (1 batch) | Against the 1500 poller budget |
|---|---:|---|
| 15s | 5760 | Budget gone in 6h15m |
| 30s | 2880 | Budget gone in 12h30m |
| **58s** | **1490** | The floor: the fastest interval that fits |
| **60s** | **1440** | **Our setting.** Fits, with 60 spare on the poller budget and the 500 reserve untouched |
| 120s | 720 | Fits with room, at the cost of a two-minute-old price |

**Our configuration: `POLL_INTERVAL_SECONDS=60`, 4 symbols in the universe,
1 batch per poll, 1440 requests/day — 96% of the poller budget and 72% of the
whole key's allowance.**

The floor of 58 seconds is derived, not picked: `ceil(86400 / 1500) = 57.6`, so
58 is the fastest interval that keeps one batch per poll inside 1500/day. It is
computed in `PollingSchedule.floorSeconds()` and applied in `PollerProperties`,
which clamps anything lower and logs a warning at startup. A
`POLL_INTERVAL_SECONDS=5` in someone's `.env` at 2am produces a 58-second poller
and a warning, not a dead key.

### Why batching is not optional

Eight symbols fetched one at a time every 30 seconds is `8 x 2880 = 23040`
requests a day. The key is exhausted after 2000, which at 16 requests a minute
is **125 minutes**. The identical data batched is 2880 — and at our 60-second
interval, 1440. Batching is the difference between a price stream and a dead key
before lunch.

### Why batching the Kafka message would be a different thing entirely

Batching the HTTP call is a quota optimisation and it is correct. Batching the
Kafka message would put several symbols behind one key, which picks one symbol's
partition for all of them and destroys the per-symbol ordering `market-data`
exists to provide. The poller therefore publishes **one message per symbol**,
keyed by that symbol — `MarketDataPoller` fans a batched response out before it
touches the producer. The two decisions look like one decision and are not.

## The poller's placement, and what it does not decide

The poller runs as a scheduled component inside the Trade Executor, in
`com.team1.executor.poller`. The reason is the key: the executor already calls
Fauxnance to price every fill, and a separate poller would mean a second process
holding the same credential, spending the same 2000 requests with no idea what
the other had spent, and an argument about which of the two owned the retry
policy. One component calls Fauxnance, so one component holds the key and one
component divides the budget.

Sharing a process is not sharing a lifecycle. A `@Scheduled` method that throws
is not necessarily rescheduled, and a poller that quietly stopped inside a
running container is harder to notice than one whose container exited — so
`MarketDataPoller.pollOnce()` catches `Throwable` at its own boundary and
returns. A failed cycle is one lost cycle, never a lost schedule.

The poller is not on the order path. It does not start a poll because an order
arrived, and `OrderConsumer` does not wait for a poll to finish. The only thing
the two share is the quota ledger.

## Symbol universe

The poller polls only what somebody holds: active instruments with a non-zero
row in `portfolio_holding` or `portfolio_positions`. Against the seeded data
that is 4 symbols (`ICICIBANK`, `INFY`, `ITC`, `RELIANCE`). `LEGACYCORP` is held
but inactive and is excluded; a zero-quantity holding is excluded.

Polling the whole instrument table instead would spend quota on prices no
consumer wants. `SymbolUniverse` is the seam where the Sprint 10 watchlist joins
this set — one more `EXISTS` clause in `SymbolMapper.xml` — and the "or watches"
half of the rule lands there when that table exists.
