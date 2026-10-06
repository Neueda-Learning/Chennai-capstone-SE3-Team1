# 0006 Watchlists hands triggered alerts to Notifications through a Java interface published by the Notifications package; no HTTP route exists for cross-module delivery

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-06 |
| Decided by | drafted by SE ahead of the Monday scope review with the instructor |

## Context

Watchlists has to tell Notifications to deliver an alert. Both modules live in the same JVM (see [0001](0001-extension-modules-live-as-packages-in-the-trade-rest-api.md)). Sprint 10 names this seam explicitly: "What watchlists calls to deliver [is] the second seam in this week's work. Write both down on Monday, as Java interfaces." It is also the seam the review will look at hardest: "An internal path reachable by a customer with a customer's token is an access-control failure the Sprint 8 review had no equivalent of." The Notifications brief is categorical: "One part of this module is not for a customer at all: what watchlists calls to have an alert delivered. That is a Java interface rather than a route. Publishing it as an HTTP route is how a customer ends up able to send themselves anything." The same reasoning covers the resolver interface Preferences publishes to Notifications (see [0003](0003-preferences-owns-contact-details-other-modules-reference-them.md)).

## Options considered

| Option | For | Against |
|---|---|---|
| HTTP route under `/api/v1/notifications/internal/deliver`, guarded with a header or a "service token" | Reusable from another service later; uniform instrumentation; would keep working if Notifications moved to a separate process | Any route under `/api/v1/` is authenticated the moment it exists and a customer token passes the standard verifier; "internal" in the path is a comment, not a guard; the review flags this exact pattern; a header-based guard duplicates the authorisation surface and tends to drift |
| Java interface `NotificationDelivery` published by the Notifications package, injected into Watchlists as a bean | In-process call, no HTTP surface added, no token verification path to misconfigure; the compiler enforces that only the Watchlists package imports the delivery API; the resolution interface from Preferences follows the same pattern, so the two seams are symmetric | Breaks if Notifications is ever extracted to a separate service — the call would have to become HTTP with a server-to-server identity; the compile-time coupling means a Notifications change can force a Watchlists recompile |
| Spring `ApplicationEvent` published by Watchlists, listened to by Notifications | Loose coupling; multiple listeners possible if other modules ever need the same signal | Hides the delivery outcome from the caller — the alert state in [0005](0005-a-price-alert-fires-once-then-deactivates.md) depends on seeing whether delivery succeeded or failed; event listeners are also harder to reason about under back-pressure |

## Decision

Option 2. Notifications publishes `NotificationDelivery.deliver(AlertNotification)` as a Spring-managed bean exposed through an interface in the Notifications package. Watchlists depends on that bean, not on anything inside the Notifications tables. No HTTP route exists for cross-module delivery. The interface returns a `DeliveryOutcome` enum (`QUEUED`, `PENDING_CHANNEL`, `REJECTED`) so the caller knows how to record the alert's final state. Option 1 is the mistake the Sprint 10 review will look for first; option 3 hides the outcome Watchlists needs to see.

## Consequences

The two modules are compile-time coupled through one interface — the only shared surface between them. If Notifications moves to a separate service in a later sprint, the interface becomes an HTTP client with a server-to-server authentication token (not a customer token), and a new ADR records that migration; the client code lives in Watchlists at that point so Notifications is unaffected. The security review entry for A01 (broken access control) states that no internal delivery path is reachable over HTTP, and the entry for A10 (SSRF) records that the delivery destination is resolved through the Preferences-owned resolver and never from the alert payload or any customer input. The symmetry with the Preferences seam ([0003](0003-preferences-owns-contact-details-other-modules-reference-them.md)) is deliberate — both internal paths that would be natural candidates for HTTP routes are closed off at compile time rather than by a check the reviewer has to notice.
