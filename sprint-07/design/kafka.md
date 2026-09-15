# Kafka topics and the message envelope - design

Status: JIRA-1 deliverable. The contracts in `contracts/kafka-topics.md` are binding; this document records why the contracted shape is the shape, and the team decisions around it. Any member must be able to defend and rerun everything here at the review.

## Decisions

| # | Decision | Commitment |
|---|---|---|
| 1 | Topic catalogue | `orders` (3p, 7d), `trade-events` (3p, 30d), `market-data` (6p, 1d), as written in `contracts/kafka-topics.md` |
| 2 | Dead-letter topics | Created explicitly, named `<topic>.DLT`, same partition count and retention as the source topic |
| 3 | Topic creation | `infra/kafka/create-topics.ps1` (PowerShell) or `infra/kafka/create-topics.sh` (Git Bash / macOS), idempotent, run against the running broker from the repository root |
| 4 | Broker config | Kafka 3.8.0 in KRaft combined mode, `auto.create.topics.enable=false`, plaintext, localhost only |
| 5 | Message envelope | Five fields plus `payload`, JSON UTF-8; additive changes allowed without a `schemaVersion` bump; consumers ignore unknown fields |
| 6 | Envelope implementation | Shared module `sprint-07/eventbus` (`com.team1:eventbus`), imported by both the REST API (publishes `ORDER_PLACED`, JIRA-3) and the executor (consumes, JIRA-4), so neither service depends on the other |
| 7 | Producer/consumer config | Per `contracts/kafka-topics.md`: `acks=all`, idempotence on, high retries, in-flight <= 5, explicit `group.id`, auto-commit off |
| 8 | Duplicate handling | Guarded state transition on the order (`WHERE id = ? AND status = 'NEW'`); DLT carries original message with failure reason in a header |
| 9 | Sprint folder | Our sprint-7 root is `sprint-07/`; the sprint README's template name is `sprint-07-event-backbone`. All paths in this document resolve under `sprint-07/` |

## Why the key is what it is

Kafka writes messages in order within a partition and gives no ordering across partitions. The key decides the partition, and the partition decides the ordering guarantee. So the key is chosen to group the messages whose relative order matters.

`orders` and `trade-events` are keyed by `accountId`. Two orders on the same account must execute in the order they were accepted: a sell must see the buy that made it possible. Two orders on different accounts have no relationship, so putting them on different partitions allows them to be processed in parallel. Per-account ordering is a platform promise; cross-account ordering is not, and no consumer may rely on it.

`market-data` is keyed by `symbol`. A consumer must never see an older quote for `AAPL` after a newer one; quotes for different symbols are independent.

Keying `orders` by `orderId` would put every message on its own partition, giving every order its own ordering domain and destroying the per-account guarantee the executor depends on. Never key by order identifier.

## Why the partition counts

- `orders` and `trade-events`: three partitions let three executor instances run in one consumer group, which is enough to demonstrate a stable group and enough to show that a consumer group cannot usefully outnumber its partitions.
- `market-data`: six partitions reflect its higher message rate.

Partitions can be increased but never decreased, and an increase rehashes keys, splitting an account's history across partitions from that point on. The counts above are therefore deliberate and final for the capstone; increasing them later re-runs the work in this sprint with a different answer.

## The envelope

One envelope on all three topics, so one deserialiser and one dead-letter handler cover the platform:

| Field | Type | Notes |
|---|---|---|
| `eventId` | string, UUID | Idempotency key for consumers |
| `eventType` | string, enum | Discriminates the payload |
| `eventTime` | string, RFC 3339 UTC | When the producer created the event |
| `source` | string | `trade-api`, `trade-executor` or `market-poller`: the producing component, not the container |
| `schemaVersion` | integer | Starts at 1; bumped only on a breaking change |
| `payload` | object | Topic- and event-type-specific |

Adding an optional field is not a breaking change and does not bump `schemaVersion`. Removing, renaming or retyping a field is. Consumers ignore fields they do not recognise, because a consumer that fails on an unknown field turns an additive change into an outage.

## Producer and consumer contract

The full matrix is in `contracts/kafka-topics.md`. The rules the team implements and demonstrates:

- `orders` has exactly one consumer group (`trade-executor`, the executor). A second group would mean two services executing the same order.
- Every consumer sets an explicit `group.id`; groups stay distinct per extension module so a redeployed consumer does not move another module's offsets.
- At-least-once delivery. Producers: `acks=all`, `enable.idempotence=true`, `retries` high, `max.in.flight.requests.per.connection<=5`. Consumers: auto-commit off, commit after processing.
- Duplicates are planned for. The executor uses a guarded state transition on the order row; the acceptance check replays an `ORDER_PLACED` and shows the cash balance does not move twice.
- Dead-letter: a malformed message goes to `<topic>.DLT` immediately; a transient failure retries with backoff and is dead-lettered only when the retry budget is spent. The DLT value is the original message and the failure reason is in a header.
- Exactly-once via Kafka transactions is deliberately not used: the side effects here are database writes, not topic writes, and the guarded transition gives the same outcome with less machinery.

Implementation homes: the REST API publishes `ORDER_PLACED` (JIRA-3), the executor consumes `orders`, produces `trade-events` and runs the poller that produces `market-data` (JIRA-8), and the analytics ETL consumes `trade-events` (JIRA-9).

## Operating the broker

- Start: `docker compose -f infra/kafka/docker-compose.yml up -d`, then `infra\kafka\create-topics.ps1` (PowerShell, Windows) or `bash infra/kafka/create-topics.sh` (Git Bash / macOS) once the broker is healthy.
- Rerun: the creation script is idempotent (`--if-not-exists`) and is the single command any teammate runs.
- Verify: `infra/kafka/create-topics.sh` finishes with `--list` and `--describe`, which show the six topics with the contracted partitions and retention.
- Auto-creation is off and stays off. A produce to a topic that was not created must fail with an error rather than silently create a one-partition topic. Prove it once: delete a topic, produce to it, observe the error, recreate it.

## Security plan

Local development runs plaintext with no authentication. This is a documented plan, not an implementation:

- TLS between clients and brokers, with per-listener certificates.
- SASL/SCRAM for client authentication, distinct users per service.
- Per-topic ACLs: only the Trade REST API may write to `orders`; only the Trade Executor may read it; `market-data` is readable by every consumer group that needs it; DLTs are writable by anyone and readable only by operations tooling.
- Group-level ACLs so a consumer cannot act as another group.

Nothing that is a credential, a full name, an email address or an API key may appear in a message payload: topics are retained for days and are read by services that have no need for that data.