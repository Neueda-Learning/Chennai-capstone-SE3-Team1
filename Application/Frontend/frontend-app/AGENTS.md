# Agent context: sprint-09-trading-ui

This file is for other agents/models picking up work in this folder. It says
what exists, what's fake, and how to extend it without breaking the visual
theme. `README.md` in this folder is the human-facing sprint deliverable doc
(workspace setup, feature-tree rationale); this file is implementation state
and extension guidance.

## Status in one line

The screens are wired to the real services: sign-in, registration (no email verification), the
dashboard, the portfolio, the market and order screen, the blotter, bank account linking and
funding, the shell's profile and notifications. What is still a placeholder is listed under
"What is still fake" below; read that before assuming a button does something.

## What exists

- Angular 21, standalone components, signals, zoneless, Vitest. See
  `README.md` for the workspace-level rationale.
- Routing (`src/app/app.routes.ts`): `/login` is a standalone route (no
  chrome). `/dashboard`, `/orders`, `/blotter` are children of a `Shell`
  layout route (`src/app/core/layout/shell.ts`) that renders the sidebar,
  top navbar, and footer around a nested `<router-outlet>`.
- Visual design: the [Spark Admin](https://github.com/themewagon/spark-admin)
  free Bootstrap 5 template, integrated as real npm dependencies
  (`bootstrap`, `bootstrap-icons`, `apexcharts` — see `package.json` and the
  `styles`/`allowedCommonJsDependencies` entries in `angular.json`) plus the
  template's own design-system stylesheet copied verbatim to
  `src/styles/spark-admin.css` (3187 lines, global, unscoped — this is
  intentional, see below). Avatar/user images live in `public/images/`.

## Where the data comes from

| Screen | Source |
|---|---|
| Dashboard (`features/dashboard`) | `GET /accounts/{id}/balance`, `/portfolio`, `/orders` and `GET /market/quotes`, refreshed every minute. Valuation maths is in `core/portfolio/portfolio-metrics.ts`. |
| Portfolio (`features/portfolio`) | Same balance, portfolio and quotes calls. |
| Market & Trade (`features/orders`, class `OrderTicketPage`) | `GET /market/quotes` every 30s, `/market/quotes/{symbol}/candles` for the chart (candles at 1m...1mo over 1H...1Y, with SMA/EMA/Bollinger/Volume/RSI/MACD toggles computed client-side in `core/charts/indicators.ts`; the setup is remembered in `localStorage`), `POST /orders`. Orders carry no typed price: they go in at the current market price (see `PRICE_PROTECTION` in `order-ticket-page.ts`). |
| Blotter | `GET /accounts/{id}/orders`. |
| Navbar search (`core/search`) | Quotes and the account's orders, fetched on first use and matched locally; opens `/orders?symbol=` or `/blotter?q=`. |
| My Account / Settings | `UserProfileStore`; settings are browser-local (theme, notification pop-ups). |
| Shell | `GET /auth/me` and `GET /accounts/{id}` for the name and email (`core/user/user-profile.store.ts`); `GET /accounts/{id}/notifications` polled every 10s (`core/notifications/notification.store.ts`). |

`/market/**`, `/accounts/{id}/portfolio` and `/accounts/{id}/notifications` are not in
`contracts/trade-api.yaml`, so their clients are hand-written in `core/services/` (the same
approach as `bank-account-reader.service.ts`). If the contract grows them, regenerate and
delete the hand-written services.

## What is still fake

- "My Account" is read-only: neither service has an edit-profile call yet.
- No user has a profile picture; `UserProfileStore.avatarUrl` is always `null` and the avatar
  component draws initials.

## Theme

Light/dark is `data-bs-theme` on `<html>`, owned by `core/theme/theme.service.ts` and applied
early by an inline script in `index.html`. Dark rules are section 26 of `spark-admin.css`
(redefined variables plus overrides for the template's hard-coded whites), prefixed
`html[data-bs-theme="dark"]` so they outrank it. A component stylesheet's selectors are scoped by
Angular and cannot be outranked from outside, so a component that hard-codes colours (the
blotter) carries its own `:host-context([data-bs-theme="dark"])` block. Charts take their colours
from `core/charts/chart-theme.ts` and redraw when the theme flips.

`HttpClient` is provided (`provideHttpClient()` in `app.config.ts`), and
typed clients generated from both contracts live under `src/app/generated/`
(`auth-client/`, `trade-client/` — see the README in that folder for the
regen command and the rules for that tree). Both are wired into
`app.config.ts` via `provideApi({ basePath: ... })` from each client's
`provide-api.ts`, aliased on import (`provideAuthApi` / `provideTradeApi`)
since both clients export a same-named `provideApi`/`Configuration`.

## Preserving the theme when you wire things up

1. **Don't touch `src/styles/spark-admin.css`.** It's a straight copy of the
   template's design system, kept global and unscoped on purpose (component
   `styleUrl` files are mostly a one-line comment pointing here) so classes
   like `.card`, `.form-control-custom`, `.btn-custom-primary`,
   `.badge-table`, `.table-custom`, `.progress-bar` stay consistent across
   every page. Reuse existing classes from that file (grep it) instead of
   writing new component-scoped CSS or inline styles. If a genuinely new
   visual pattern is needed, add a new block to that file rather than
   fragmenting the design system across component stylesheets.
2. **Color/spacing tokens are CSS custom properties** on `:root` near the top
   of `spark-admin.css` (`--brand-forest-dark`, `--brand-lime`, `--radius-*`,
   `--shadow-*`, etc.) — use `var(--token)`, don't hardcode hex values.
3. **Icons** come from Bootstrap Icons (`<i class="bi bi-*"></i>`), already
   loaded globally. Don't add another icon library.
4. **Charts** use `apexcharts` imported directly in the component
   (`import ApexCharts from 'apexcharts'`), rendered in `ngAfterViewInit`
   against a `viewChild.required<ElementRef>` template-ref div, and
   destroyed in `ngOnDestroy`. Follow that pattern — see
   `dashboard-page.ts` — rather than adding chart config to `main.ts` or a
   global script.
5. **Bootstrap's JS** (dropdowns, collapses) is imported once, as a
   side-effecting import, in `src/main.ts`
   (`import 'bootstrap/dist/js/bootstrap.bundle.min.js'`). It self-registers
   global delegated listeners, so `data-bs-toggle="dropdown"` markup works
   in any new component without importing anything else. Don't re-import
   Bootstrap JS per-component.
6. **Layout structure**: any new authenticated page goes as a child route
   under the `Shell` in `app.routes.ts` (gets sidebar/navbar/footer for
   free); anything meant to look like the login screen (no chrome) goes as
   a sibling top-level route instead.
7. **File/naming conventions**: 2025 Angular style guide (`order-ticket-page.ts`,
   not `.component.ts`; class `OrderTicketPage`, not `...Component`),
   selector prefix `tui-`, spec file beside every component.

## Adding to it

- Services that call the generated clients go in `core/services/` or beside the feature. Inject
  the generated service directly; wrap it only when its generated shape is genuinely awkward.
- Sign-in state is `core/auth/session.store.ts`. The signed-in person is
  `core/user/user-profile.store.ts`. Both are signal-based, root-provided services.
- Request/response shapes come from the generated model types in
  `src/app/generated/{auth,trade}-client/model/`; do not hand-declare interfaces that duplicate
  them. If a contract changes, rerun `npm run generate:clients`.
- Component specs that talk to the API use `testing/fake-api.ts`: register what each URL answers,
  then `flush()`. Anything polled on a timer needs `vi.useFakeTimers()`.

## Commands

```bash
npm ci              # clean install from committed lock file
npm run build         # production build → dist/trading-ui
npm test              # Vitest, single run: npm test -- --watch=false
npm start             # dev server, http://localhost:4200
```
