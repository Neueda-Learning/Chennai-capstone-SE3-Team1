# Sprint 9 — Trading UI

Angular workspace for the trading platform's front end: login, dashboard, order
 ticket and blotter, talking to the Trade API and the auth service defined in
`../../Contracts/api-schemas/`.

## Workspace

- Angular 21.2, one workspace, one application (`trading-ui`), scaffolded with
  `ng new` — no NgModules, standalone components throughout, signals for
  component state, zoneless change detection (no `zone.js` dependency).
- Test runner: Vitest (the Angular CLI default for v21), not Karma — it runs
  headless in Node via jsdom, so `npm test` needs no browser installed on the
  CI machine or a teammate's laptop.
- Supported Node: `^20.19.0 || ^22.12.0 || >=24.0.0`, matching Angular 21's
  own peer requirement (recorded in `package.json#engines`). Developed and
  verified against Node 24.10.0.
- Requires a Java runtime on `PATH` (Temurin 25 verified). `npm install`/
  `npm ci` runs `postinstall` → `generate:clients`, which regenerates the
   typed API clients from `../../Contracts/api-schemas/` via OpenAPI Generator, a
  JVM tool. No Java means the install fails outright — see
  `src/app/generated/README.md`.

```bash
npm ci              # install; also regenerates src/app/generated/ (needs Java)
npm run build        # production build, output in dist/trading-ui
npm test             # Vitest, headless, single run in CI: npm test -- --watch=false
npm start            # dev server, on FRONTEND_HOST:FRONTEND_PORT from Application/Config/services.env
```

All three of `npm ci`, `npm run build` and `npm test` are verified to pass
from a clean `node_modules`/`dist` on the committed lock file, given Java on
`PATH` — that's the acceptance bar for this story, not just "works on my
machine".

## Feature tree

```
src/app/
  app.ts / app.html / app.css / app.spec.ts   Root shell: header + <router-outlet>
  app.routes.ts                                Top-level route table, one entry per feature
  app.config.ts                                Application-wide providers (router, error listeners)
  features/
    landing/         landing-page.ts           Public landing/home page (/) 
    auth/            login-page.ts             Credentials form against the auth service
    dashboard/       dashboard-page.ts         Landing page: balance and positions summary
    orders/           order-ticket-page.ts     Place an order against the Trade API
    blotter/          blotter-page.ts          Order and trade history table
```

The split is one folder per user-facing feature under `features/`, named for
what a user does there rather than what data it shows, matching the four
screens the root README commits the Trading UI to. Each feature folder is
flat — component, template, stylesheet and spec side by side, `<name>.ts` /
`.html` / `.css` / `.spec.ts` — so a reviewer opens one folder and sees the
whole feature, no hunting across parallel `components/` and `tests/` trees.

Every route in `app.routes.ts` lazy-loads its page component
(`loadComponent`), so the initial bundle stays just the shell and each
feature ships as its own chunk — confirmed in the `npm run build` output,
where `landing-page`, `login-page`, `dashboard-page`, `order-ticket-page` and
`blotter-page` each land in a separate lazy chunk under a kilobyte.

### UI Improvements (Current Session)

- **New Landing Page**: Professional public-facing landing page at `/` with features, hero section, and CTA
- **Redesigned Login Page**: Full-screen two-column layout with hero section on left, login form on right
- **Modern Styling**: Updated to follow the Spark Admin design system with improved spacing and visual hierarchy
- **Form Optimization**: Login form fits screen height properly with improved input styling and button design
- **Responsive Design**: All pages responsive and mobile-friendly

### Watchlists, price alerts and chart markers

Nobody has to know or type a symbol. Every place that picks instruments uses `shared/symbol-picker`, a
search box with a drop-down that matches forgivingly (`core/search/fuzzy.ts`: prefixes, words inside a company
name, skipped letters and typos, so "infsys" finds Infosys and "rlnc" finds Reliance). It is a multi-select with
chips for watchlists and a single select for price alerts.

| Where | What |
|---|---|
| Dashboard | The **Watchlist** section (tabs when there are several lists, a multi-select to add, an inline "create your first watchlist") and the **Price Alerts** card (search a stock to open its chart, plus the alerts that are still watching and how far each is from its level). They replace the old Order Flow chart and Order Summary. |
| Watchlists page | Every watchlist, each with a multi-select that adds several instruments at once; the alerts panel (search a stock, chart with markers, all alerts). `?alert=TCS` opens that stock's chart; the bell beside any watchlist entry links there. |
| Market & Trade | An **Alert** button beside Trend (with the count of armed alerts) opens the chart in marker mode; the Trend chart carries the same panel. |

**Placing an alert on a chart.** Turn on "Set alerts on the chart", move the pointer (a guide line and a price tag
follow it), click where the alert should go, and confirm. A level above the current price waits for a rise to it,
a level below waits for a fall, so direction is never asked for. The price can also be typed, or set with the
quick -5% / -2% / +2% / +5% buttons, for anyone not using the pointer. Existing alerts are drawn as labelled lines
(watching in green or red, triggered and off in grey) and listed under the chart to turn off, re-arm or delete.

How it fits together:

```
core/search/fuzzy.ts                 forgiving search
core/services/instrument-catalog     every tradable instrument, for the search boxes
core/watchlists/watchlist.store      watchlists + alerts, held once; polled while any page that shows them is open
core/charts/price-axis.ts            pixel <-> price conversion for the chart
features/orders/price-chart          draws alert lines and the marker guide; emits the clicked price
shared/symbol-picker                 the search box
shared/watchlist-card                one watchlist: table + multi-select add
shared/alert-composer                confirm a marker, type a price, manage a stock's alerts
shared/alert-chart                   chart + composer for one stock (Watchlists page)
shared/alert-list                    all alerts, with distance to level
```

Two gotchas worth knowing: in a component's stylesheet use `:host-context(html[data-bs-theme='dark'])` for dark
overrides (a plain `html[data-bs-theme='dark'] ...` selector never matches, because Angular adds the component's
scope attribute to `html` as well), and jsdom has no layout, so specs stub the chart geometry
(`PriceChart.prototype.geometry`) when they click on it.

## E2E Testing with Playwright

`e2e/` drives the real screens against the real services — no mocked network, no stubbed
auth. Start the stack first (`.\run-local.ps1` from the repo root: auth `:3000`, Trade API
`:8081`, executor `:8082`, Postgres, Kafka), then:

```bash
npm install
npx playwright install          # one-time browser download
npm run test:e2e                # Chromium + Firefox, headless
npm run test:e2e:ui             # interactive UI mode
npm run test:e2e:debug          # Playwright Inspector
npx playwright show-report      # open the HTML report
```

Playwright starts `npm start` itself and waits for the frontend's address from
`Application/Config/services.env`, so the dev server does not need to be running first.

### What is covered (51 tests, `e2e/`)

| Spec | Covers |
|---|---|
| `signin.spec.ts` | The guard bounces a signed-out visitor off a protected route and keeps the destination; unknown username, empty form, successful sign-in, return-URL redirect, Remember Me in `localStorage` vs the tab only, password reveal |
| `account.spec.ts` | Signed-in shell naming the account, sign-out re-arming the guard, dashboard cash matching the Trade API, dashboard order summary, portfolio holdings, sidebar navigation |
| `order-ticket.spec.ts` | Market list loading and auto-selected ticker, estimate tracking quantity, quantity validation (0, negative, fractional, empty) blocked before any `POST /orders`, insufficient-cash and oversell refusals, a one-unit buy accepted, appearing in the blotter and debiting the wallet |
| `blotter.spec.ts` | Every order the Trade API holds, search narrowing the list, an empty search result, the status filter options, opening an order for detail |

`auth.setup.ts` signs in once and writes `e2e/.auth/user.json`; the Chromium and Firefox
projects reuse it, and the sign-in specs opt out of it to start from a clean session. The
order-placement test places one real order per run, so the account's cash and blotter move
between runs — the assertions compare a before/after read rather than fixed values.

### Configuration

`playwright.config.ts` reads the repository's one `.env` (copy the root `.env.example`; `.env`
is ignored by git, as is `e2e/.auth/`). The addresses of the UI, the auth service and the Trade API are
not set here: they come from `Application/Config/services.env` (`scripts/service-config.mjs`). One
already set in the environment wins:

| Variable | Meaning |
|---|---|
| `BASE_URL` | Override for the UI under test (default: `FRONTEND_HOST:FRONTEND_PORT`) |
| `AUTH_API_BASE` | Override for the auth service, read directly to confirm a session was refused |
| `TRADE_API_BASE` | Override for the Trade API base, without the `/api/v1` prefix |
| `TEST_USERNAME` / `TEST_PASSWORD` | An existing account on the local auth service |

### Where the app finds the backend

The app does not know any address at build time. `npm start` and `npm run build` first run
`scripts/generate-config.mjs`, which writes `public/config.json` (git-ignored) from
`Application/Config/services.env`; `src/main.ts` loads it before the app starts and the generated API
clients get their base paths from it (`src/app/core/config/runtime-config.ts`). Run `npm run config` to
regenerate it by hand, and `npm run test:config` for the script's own tests.

The Trade API account id is not configured: `e2e/api.ts` reads it out of the session token the
UI itself is holding, so the API cross-checks cannot drift from the account on screen.

Registration is not covered: each run would leave a new user behind. Sign in with an account
that already exists. The auth
service locks a username after five failed attempts in 15 minutes, so the invalid-credential
test uses a username that does not exist rather than a wrong password.
