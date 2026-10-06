# 0002 One consumer group per extension module, named for the module

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-06 |
| Decided by | drafted by SE ahead of the Monday scope review with the instructor |

## Context

Three of the four extensions consume Kafka. `MarketDataListener` already runs inside order-service with `groupId = "portfolio-service"` on topic `market-data`, consuming quotes and marking positions to market. This week adds a `trade-events` consumer for Customer Notifications and a second `market-data` consumer for Watchlists, both running inside the same JVM. The platform topic catalogue is binding on this point: `Application/Contracts/event-schemas/kafka-topics.md` says "Every consumer sets an explicit `group.id`. Two different consumers sharing a group identifier will split the partitions between them and each will see only part of the stream, which presents as messages going missing at random." It also lists the group id for each module by name: `notification-service`, `watchlist-service`, `portfolio-service`.

## Options considered

| Option | For | Against |
|---|---|---|
| Separate group per module: `notification-service`, `watchlist-service`, `portfolio-service` | Each module's offsets are independent — redeploying one does not move another's position in the stream; a watchlist consumer that falls behind does not stall notifications; matches the names fixed by `kafka-topics.md` | Three sets of consumer offsets to monitor instead of one; three group ids to keep distinct forever |
| Shared group across modules in the same JVM | One offset to reason about; fewer configuration surfaces | Kafka would assign the three partitions between the three consumers rather than sending every message to each — notifications would see one third of `trade-events`, watchlists one third of `market-data`, portfolio one third of its own feed; this is silent data loss, not a performance issue |
| One group for watchlists and portfolio because both consume `market-data` | Two consumers on the same topic in the same process; appears to deduplicate work | Portfolio marks positions to market on every quote and watchlists evaluates thresholds on every quote; they are different side effects on the same message, so sharing a group loses one of them per quote |

## Decision

Separate groups, one per module, with the names fixed by `kafka-topics.md`. Customer Notifications consumes `trade-events` with `group.id = notification-service`. Watchlists consumes `market-data` with `group.id = watchlist-service`. The existing `portfolio-service` group on `MarketDataListener` is unchanged. Options 2 and 3 are not design choices — they are Kafka's rule for partition assignment, and sharing a group id across logically independent consumers in one process is the exact failure mode the topic contract warns about by name.

## Consequences

Three group ids live on the operational surface of order-service, listed in each module's README. Any team member creating a new consumer picks a name that no other module uses; a group id adopted twice would silently split the messages. A redeployed notifications consumer does not move the watchlist consumer's position in the stream — which also means that running in one process (the choice in [0001](0001-extension-modules-live-as-packages-in-the-trade-rest-api.md)) changes nothing about offsets. Scaling past the partition count buys nothing: `market-data` has six partitions and `trade-events` has three, so a seventh instance of watchlists or a fourth instance of notifications is an idle consumer. This cap is recorded next to the compose entry for the Trade REST API.
