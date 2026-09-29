# Sprint 9 — Trading UI

Angular workspace for the trading platform's front end: login, dashboard, order
ticket and blotter, talking to the Trade API and the auth service defined in
`contracts/`.

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
  typed API clients from `sprint-06-api/contracts/` via OpenAPI Generator, a
  JVM tool. No Java means the install fails outright — see
  `src/app/generated/README.md`.

```bash
npm ci              # install; also regenerates src/app/generated/ (needs Java)
npm run build        # production build, output in dist/trading-ui
npm test             # Vitest, headless, single run in CI: npm test -- --watch=false
npm start            # dev server at localhost:4200
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
where `login-page`, `dashboard-page`, `order-ticket-page` and `blotter-page`
each land in a separate lazy chunk under a kilobyte.

This story only stands the workspace up and stakes out where each feature
lives; the pages above are placeholders (a heading and a one-line note on
what belongs there) with a passing spec each, established now so later
stories add real behaviour to an already-agreed location instead of
negotiating structure mid-feature.

**Not created yet, on purpose:** `core/` (singleton services — auth session
state, the HTTP interceptor that attaches the bearer token, error handling)
and `shared/` (reusable presentational components/pipes used by more than one
feature). Both belong in this tree once a story actually needs them; an empty
folder tracked in git for a directory that doesn't exist yet would just be
noise. The Playwright e2e suite is likewise a separate, later story.

The typed API clients generated from `sprint-06-api/contracts/` now exist
under `src/app/generated/` (see the README there) and are wired into
`app.config.ts` via `provideHttpClient()` and each client's `provideApi()`.
No feature page calls them yet — that's still later stories; this one only
stands the generated clients up and makes them injectable.

## Conventions

- File naming follows the Angular 2025 style guide (the CLI default for v21):
  `login-page.ts`, not `login-page.component.ts`; class `LoginPage`, not
  `LoginPageComponent`.
- Component selector prefix is `tui` (`tui-root`, `tui-login-page`, ...) to
  keep it distinct from any other prefix used elsewhere in the monorepo.
- Every component has its spec beside it, not in a separate test tree.
