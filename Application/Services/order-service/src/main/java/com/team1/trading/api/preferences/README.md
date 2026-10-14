# Preferences

Per-customer record of the alert channel and the default account. Owns the one table that says how to reach a customer (`customer_preferences`) and publishes the resolver other modules use to find out where.

| | |
|---|---|
| Routes | `GET` and `PUT /api/v1/accounts/{accountId}/preferences` ([`preferences-api.yaml`](../../../../../../../../../../Contracts/api-schemas/preferences-api.yaml)) |
| Table | `customer_preferences` (migration `026`); holds the channel choice, never a copy of an email address |
| Published seam | `PreferenceResolver.resolve(long) -> Optional<ResolvedChannel>` ([`integration-seams.md`](../../../../../../../../../../../docs/sprint-10/integration-seams.md)) |
| Decisions | [`0003`](../../../../../../../../../../../decision-log/0003-preferences-owns-contact-details-other-modules-reference-them.md), [`0006`](../../../../../../../../../../../decision-log/0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md), [`0007`](../../../../../../../../../../../decision-log/0007-default-account-is-the-customers-own-and-a-missing-address-resolves-to-empty.md) |

## Rules this package keeps

- **Own account only.** `PreferenceController` calls `AccessGuard.requireOwner` before anything else; the token's `accountId` must equal the path account or the answer is `ACC-403`. There is no admin bypass on these routes.
- **No contact details in or out.** The request body accepts `defaultAccountId` and `channel` and rejects any other property (`VAL-422`); the response carries no address. The email address is read from `users` only inside `DatabasePreferenceResolver`. SMS is not a channel ([`0009`](../../../../../../../../../../../decision-log/0009-sms-is-not-a-channel-and-email-uses-the-auth-services-smtp-account.md)).
- **No route for the resolver.** The resolver is a Java interface. `NoResolverRouteTest` fails the build if any `@RestController` path contains `resolve`, `deliver` or `/internal`.
- **Never logged.** `ResolvedChannel.toString()` and `ResolutionRow.toString()` mask the address. `PreferenceService` logs `accountId` and `channel` only.
- **No cache.** The resolver's queries use `flushCache = TRUE`, so an email changed in `users` is used on the very next call.

## What the resolver returns

| Situation | Result |
|---|---|
| No row, or `channel` is `NULL` | `Optional.empty()` |
| `EMAIL` | profile email, or `channel_contact_override` when set |
| `PUSH` | `account:{accountId}` |
| Database failure, a stored row with no `users` row, or an unknown stored channel | throws `PreferenceResolutionException` |

## Tests

`PreferenceServiceTest`, `PreferenceControllerWebTest`, `DatabasePreferenceResolverTest`, `PreferenceResolverFailureTest`, `ResolvedChannelTest`, `NoResolverRouteTest` (H2 schema in `src/test/resources/schema.sql`). The Postgres migration is covered by `tests/test_migrations.py`.
