# 0007 The default account is the customer's own account; a channel that needs an address the customer has not given resolves to empty

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-06 |
| Decided by | drafted by SE while building Preferences (SEC3-589); to be confirmed with the instructor at the scope review |

## Context

Building Preferences ([`0003`](0003-preferences-owns-contact-details-other-modules-reference-them.md)) raised two questions the brief and the earlier ADRs leave open.

**What is a "default account"?** The brief gives a preference record a default account and says it is applied at the next sign-in. In this platform a customer is one row in `users` with one `accountId`, the token carries exactly that `accountId`, and every per-account route refuses a path account that differs from the claim (`ACC-403`). There is no list of accounts a customer can switch between. A "default account" that could be any other account would either be useless (the token still refuses it) or a hole (if a route trusted it).

**What does the resolver return when the chosen channel has nothing to send to?** [`integration-seams.md`](../docs/sprint-10/integration-seams.md) names two `Optional.empty()` cases (no row, `NULL` channel). A customer can legitimately choose SMS while having no phone on their profile, and `channel_contact_override` is `NULL` for everyone this sprint. The seam does not say what happens.

## Options considered

| Option | For | Against |
|---|---|---|
| Default account may be any account id the customer names | Matches the wording of the brief literally | The id cannot be checked against anything but the token, so it is either always the token's account or rejected later; stores a value nobody can act on |
| Default account must be one of the customer's own accounts, today exactly the token's account | Validated at write against `users`; the sign-in step can compare it to the token with no extra trust; the column and route shape survive unchanged if a customer ever gets several accounts | The field carries no choice yet; the screen shows it read-only |
| Drop the field | Honest about today's data model | Departs from the brief's contract (`{defaultAccountId, channel}`) that Notifications, the Angular app and the OpenAPI file already assume |
| SMS with no phone: resolver throws `PreferenceResolutionException` | Loud | The exception is for infrastructure failure only (seam 1); Notifications would log an error every retry for a situation that is a customer's data, not a fault |
| SMS with no phone: save is refused at write time only | Stops the customer reaching the state through the screen | The profile phone can be removed later in `auth_db.users`, so the resolver meets the state anyway |
| SMS with no phone: resolver returns `Optional.empty()` and the save is also refused | Notifications holds the message as `PENDING_CHANNEL` and the retry scanner picks it up once a phone appears ([`0004`](0004-notifications-holds-messages-as-pending-channel-when-no-preference-is-stored.md)); no new code path in Notifications | Adds a third meaning to `empty()`, recorded in the seam document |

## Decision

1. The second option for the default account. `PUT /api/v1/accounts/{accountId}/preferences` accepts a `defaultAccountId` only if it is one of the signed-in customer's own accounts (checked against `users` on every write); otherwise `422 PRF-422`. The Angular app applies the stored default after sign-in only when it equals the `accountId` claim of the token it already holds (`SessionStore.selectAccount`); any other value is ignored. The lookup is bounded by a three-second timeout and any failure, including `PRF-404`, leaves the customer signed in as before: sign-in never waits on Preferences.
2. The last option for a missing address. The resolver returns `Optional.empty()` when the stored channel needs an address the customer has not given (`SMS` with no phone and no override; `EMAIL` is always present because `users.email` is required). The write route also refuses `SMS` with no phone (`PRF-422`) so the screen cannot create the state. A stored row whose `users` row is gone, or whose stored channel is not one of `EMAIL`/`SMS`/`PUSH`, is a data fault and throws `PreferenceResolutionException`.
3. `PUSH` resolves to the in-app address `account:{accountId}` and needs no contact detail.

## Consequences

`integration-seams.md` lists three `Optional.empty()` cases rather than two; Notifications' behaviour for all three is the same row (`PENDING_CHANNEL`), so nothing in seam 1's callers changes. If customers gain several accounts later, the write check widens from "equals the token's account" to "belongs to the customer", the sign-in rule becomes "ask the auth service for a token for that account", and a new ADR records it. The security review's A07 row ("default account must not be selectable once it no longer belongs to the customer") is met today by the token-equality rule; the residual is that the server does not re-validate the stored value on read, which is harmless because no route reads the stored default to authorise anything.
