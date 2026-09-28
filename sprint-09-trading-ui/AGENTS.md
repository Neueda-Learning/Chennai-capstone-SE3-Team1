# Agent context: sprint-09-trading-ui

This file is for other agents/models picking up work in this folder. It says
what exists, what's fake, and how to extend it without breaking the visual
theme. `README.md` in this folder is the human-facing sprint deliverable doc
(workspace setup, feature-tree rationale); this file is implementation state
and extension guidance.

## Status in one line

The visual UI for all four screens is built and styled. **Nothing is wired to
a backend.** No `HttpClient`, no auth, no real form submission, no live data
anywhere. Every number, row, and list item you see is a hardcoded literal in
a component file.

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

## Where the mock data lives (replace these, not the markup around them)

| Page | File | What's fake |
|---|---|---|
| Login | `features/auth/login-page.ts` | `onSubmit()` just calls `preventDefault()` and flips a `submitted` signal for Bootstrap's validation CSS. No `HttpClient`, no call to the auth service's `/auth/login`. |
| Dashboard | `features/dashboard/dashboard-page.ts` + `.html` | Portfolio value, P&L, order-flow chart series, allocation donut, "Recent Orders" list, "Order Summary" progress bars — all literals in the `.ts`/`.html`. |
| Order ticket | `features/orders/order-ticket-page.ts` | `onSubmit()` is a no-op (`preventDefault()`). Buy/Sell and Market/Limit are local UI state (signals), not sent anywhere. Wallet balance card is a literal. |
| Blotter | `features/blotter/blotter-page.ts` | `const MOCK_ROWS` — five hardcoded rows. |
| Shell | `core/layout/shell.ts` / `.html` | "Demo Trader" name/avatar/email is static markup, not a session. Notification dropdown items are static. |

There is no service layer (`core/services/` or similar doesn't exist yet), no
`HttpClient` provider in `app.config.ts`, and no typed client generated from
`contracts/`.

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

## Wiring up real functionality — where things should go

- Add an `core/services/` (or similar) folder for `HttpClient`-based services
  once real API calls start. None exists yet — don't guess an API shape
  that isn't in `contracts/`.
- Add `provideHttpClient()` to `app.config.ts` when the first service needs it.
- An auth/session store (likely a signal-based service holding the current
  user + token) doesn't exist yet. The `Shell`'s hardcoded "Demo Trader"
  block and the profile dropdown's "Logout" link (`routerLink="/login"`)
  are the two spots that will need to read real session state.
- Match request/response shapes to `contracts/auth-api.yaml` and
  `contracts/trade-api.yaml` at the repo root — don't invent field names.

## Commands

```bash
npm ci              # clean install from committed lock file
npm run build         # production build → dist/trading-ui
npm test              # Vitest, single run: npm test -- --watch=false
npm start             # dev server, http://localhost:4200
```
