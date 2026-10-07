# 0014 Watchlists publishes the symbols a customer watches through a Java interface, and Advice reads holdings through the portfolio layer

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-07 |
| Decided by | drafted while building the Trade Advice stretch extension; to be confirmed with the instructor |

## Context

Trade Advice states a view "against holdings and watchlist". The watchlist tables belong to the Watchlists module, which until now published nothing (`integration-seams.md` listed "—" in its column). 0001 and the seams document forbid one module reading another's tables, and 0006 rejected HTTP routes for module-to-module calls because any route under `/api/v1/` is reachable with a customer token. Holdings live in `portfolio_holding`, served by `AccountService.getPortfolio`.

## Options considered

| Option | For | Against |
|---|---|---|
| Advice queries `watchlist_instruments` with its own mapper | Quickest | Exactly the boundary breach a reviewer greps for; a schema change in Watchlists would break Advice silently |
| Advice calls `GET /api/v1/accounts/{id}/watchlists` over HTTP | Uses a published contract | Needs a customer token or a service bypass; returns far more than symbols (names, ids, prices) |
| Watchlists publishes `WatchedSymbols.symbolsWatchedBy(accountId) -> List<String>` | Same pattern as seams 1 and 2; reveals symbols only; Watchlists keeps its tables private and can change them freely | One more interface to keep stable |

## Decision

The interface, implemented package-private by `DatabaseWatchedSymbols` in `watchlists`. It is documented as seam 3 in `docs/sprint-10/integration-seams.md`. Holdings are read through `AccountService.getPortfolio(accountId, accountId)`, the service that already serves them, so Advice inherits its account-state checks rather than repeating a query.

## Consequences

The interface is called after the Advice controller's `ACC-403` check, with the path account, so it never answers for an account the caller does not own. Advice's only imports from other extension modules are `WatchedSymbols`; a grep for `api.watchlists` in `advice` should find that one line. If Watchlists ever gains per-watchlist privacy (a shared list, say), the interface is where that rule goes.
