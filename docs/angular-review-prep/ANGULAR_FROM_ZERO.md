# Angular From Zero — Using This Project as the Textbook

**Who this is for:** someone who has never used Angular and has to explain and defend this
frontend in a code review. Every concept is explained in plain words first, then shown with real
code from this repo (paths are relative to `Application/Frontend/frontend-app/`).

**How to read it:** Part 1–2 give you the big picture. Part 3–10 are the concepts, one at a
time, each ending with "why it's like this here". Part 11 walks through complete user flows.
Part 12 is the review-prep section: what a reviewer will probably say, and your answers.
Part 13 is a glossary.

---

## Table of contents

1. [The 60-second mental model](#1-the-60-second-mental-model)
2. [The toolbox: what each tool in `package.json` is for](#2-the-toolbox)
3. [Project map](#3-project-map)
4. [What happens when the page loads (boot sequence)](#4-boot-sequence)
5. [Components and templates](#5-components-and-templates)
6. [Signals: how the screen knows to update](#6-signals)
7. [Dependency injection and "stores"](#7-dependency-injection-and-stores)
8. [Routing, lazy loading and guards](#8-routing-lazy-loading-and-guards)
9. [Talking to the backend: HttpClient, generated clients, interceptors](#9-talking-to-the-backend)
10. [RxJS: the "stream" part you can't avoid](#10-rxjs)
11. [Forms](#11-forms)
12. [Lifecycle and cleanup](#12-lifecycle-and-cleanup)
13. [End-to-end flows](#13-end-to-end-flows)
14. [Styling and theming](#14-styling-and-theming)
15. [Testing](#15-testing)
16. [Build, config and commands](#16-build-config-and-commands)
17. [Design decisions: "why is it like this?"](#17-design-decisions)
18. [Code-review prep: known issues and likely questions](#18-code-review-prep)
19. [Glossary](#19-glossary)

---

## 1. The 60-second mental model

Angular is a **framework for building a web page that behaves like an app**. Instead of the
server sending a new HTML page for every click, the browser downloads one JavaScript bundle once,
and from then on JavaScript redraws parts of the page and talks to the backend with background
requests (a "single-page application", SPA).

The whole thing is built from five ideas. If you understand these, you understand the project:

| Idea | One-line meaning | Where you see it here |
|---|---|---|
| **Component** | A reusable piece of screen = a TypeScript class + an HTML template + CSS | `LoginPage`, `DashboardPage`, `Shell`, `ToastContainer` |
| **Signal** | A variable that *tells the screen when it changes* | `signal('')`, `computed(...)` all over |
| **Service / Store** | A plain class that holds shared state or does work, created once and shared | `SessionStore`, `NotificationStore`, `MarketService` |
| **Router** | Maps a URL to a component and decides who is allowed in | `app.routes.ts`, `auth.guard.ts` |
| **HttpClient + Observables** | How you call the backend and receive results over time | generated clients, `bearer.interceptor.ts` |

**The data flow in one sentence:** the user does something → an *event handler* in a component
runs → it changes a *signal* or calls an *API* → the API answer changes a signal → Angular
automatically re-renders only the parts of the template that read that signal.

```
 user clicks  ──►  event handler  ──►  HTTP call  ──►  backend
      ▲                                    │
      │                                    ▼
  screen updates  ◄──  signal changes  ◄──  response arrives
```

---

## 2. The toolbox

From [package.json](../../Application/Frontend/frontend-app/package.json). You don't need to
know these deeply, but you should be able to say what each is *for*.

| Tool | What it is | Why it's here |
|---|---|---|
| **TypeScript** (`typescript`) | JavaScript with types. Catches "you passed a string where a number belongs" before the code runs. | Angular is written in it. `strict: true` is on in `tsconfig.json`, so the compiler is picky on purpose. |
| **Angular** (`@angular/core`, `common`, `router`, `forms`, `platform-browser`) | The framework itself, split into packages. Version 21. | `core` = components/signals/DI; `router` = URLs; `forms` = form handling; `common` = HttpClient + helpers. |
| **Angular CLI** (`@angular/cli`, `@angular/build`) | The `ng` command: serves, builds, tests. | `npm start` = `ng serve`, `npm run build` = `ng build`. |
| **RxJS** (`rxjs`) | A library for "streams of values over time". | Angular's HTTP calls return RxJS Observables. |
| **Bootstrap 5** + **bootstrap-icons** | Ready-made CSS (grid, buttons, alerts) and icons. | Visual styling; the template "Spark Admin" is built on it. |
| **ApexCharts** | Charting library. | Dashboard charts and the price chart. |
| **OpenAPI Generator** (`@openapitools/openapi-generator-cli`) | Reads an API spec (YAML) and *writes TypeScript code* to call that API. | Produces `src/app/generated/auth-client` and `trade-client`. Needs Java. |
| **Vitest** + **jsdom** | Unit test runner + a fake browser. | `npm test`. |
| **Playwright** (`@playwright/test`) | Drives a real browser through the app. | End-to-end tests in `e2e/`. Needs the backend running. |
| **Prettier** | Code formatter. | Keeps style consistent (`.prettierrc`). |

---

## 3. Project map

```
frontend-app/
├─ angular.json            ← build/serve/test settings, bundle-size budgets, global CSS list
├─ package.json            ← dependencies + npm scripts
├─ tsconfig*.json         ← TypeScript settings (strict mode etc.)
├─ openapi-generator/      ← config for generating the API clients
├─ e2e/                    ← Playwright browser tests
├─ public/images/          ← static files copied as-is (favicon, avatars)
└─ src/
   ├─ index.html           ← the one HTML page; contains <tui-root>
   ├─ main.ts              ← the first code that runs
   ├─ styles.css           ← small global stylesheet
   ├─ styles/spark-admin.css  ← 4,165-line global design system
   └─ app/
      ├─ app.ts            ← the root component
      ├─ app.config.ts     ← "what services exist" (providers)
      ├─ app.routes.ts     ← URL → page table
      ├─ core/             ← app-wide plumbing used by many pages
      │   ├─ auth/         ← session store, guard, interceptor, return-URL safety
      │   ├─ layout/       ← Shell: sidebar + top bar around logged-in pages
      │   ├─ notifications/← bell + toast pop-ups, polling
      │   ├─ services/     ← hand-written API calls (market, portfolio, bank read)
      │   ├─ search/ theme/ user/ charts/ format/ errors/ portfolio/
      ├─ features/         ← one folder per screen
      │   ├─ landing/ auth/ dashboard/ portfolio/ orders/ blotter/
      │   ├─ bank-accounts/ account/ settings/
      ├─ generated/        ← machine-written API clients (don't edit by hand)
      └─ testing/fake-api.ts ← fake backend for tests
```

**Conventions to know** (from `AGENTS.md`): files are named `thing-page.ts` (not
`thing.component.ts`); class names are `ThingPage`; every component's selector starts with
`tui-` (`tui-login-page`); a `.spec.ts` test sits beside nearly every file.

**`core/` vs `features/`:** `core` is "things the whole app needs" (login state, the HTTP
interceptor, the layout). `features` is "one screen each". A page may use `core`; `core` should
not depend on a specific page.

---

## 4. Boot sequence

What runs, in order, when someone opens `http://localhost:4200`:

1. **`index.html`** loads. It contains a tag `<tui-root></tui-root>` and a tiny inline script that
   applies the saved light/dark theme before anything draws (so there's no white flash).
2. **`main.ts`** runs:
   ```ts
   import 'bootstrap/dist/js/bootstrap.bundle.min.js';   // makes dropdowns etc. work
   bootstrapApplication(App, appConfig).catch((err) => console.error(err));
   ```
   "Bootstrap" here means *start the app* (unrelated to the CSS framework of the same name).
3. **`appConfig`** ([app.config.ts](../../Application/Frontend/frontend-app/src/app/app.config.ts))
   is the list of **providers** — the services and settings available app-wide:
   - `provideRouter(routes)` — turn on the router with our route table
   - `provideHttpClient(withInterceptors([bearerInterceptor]))` — turn on HTTP, and run every
     request through our interceptor
   - `provideAuthApi({ basePath: 'http://localhost:3000' })` and
     `provideTradeApi({ basePath: 'http://localhost:8081' })` — tell the two generated clients
     where their backends live
   - `provideBrowserGlobalErrorListeners()` — report uncaught errors
4. **`App`** ([app.ts](../../Application/Frontend/frontend-app/src/app/app.ts)) is the root
   component. Its entire template is `<router-outlet />` — "put whichever page matches the URL
   here". It also injects `ThemeService` purely so the service is created and applies the theme.
5. The **router** reads the URL, finds the matching route, loads that page's code, and renders it
   inside the outlet.

**Zoneless:** older Angular used a library (zone.js) that watched *everything* and re-checked the
whole page after any async event. This project doesn't use it (note there's no
`provideZoneChangeDetection`). Instead, **signals** tell Angular exactly what changed. That's why
state here is kept in signals — it isn't just style, it's what makes the screen update.

---

## 5. Components and templates

### 5.1 Anatomy of a component

A component = **a class** (the logic) + **a template** (the HTML) + **styles**.
From `features/auth/login-page.ts`:

```ts
@Component({
  selector: 'tui-login-page',          // the custom HTML tag name
  imports: [RouterLink, ThemeToggle],  // other components/directives the template uses
  templateUrl: './login-page.html',    // the HTML file
  styleUrl: './login-page.css'         // CSS scoped to this component
})
export class LoginPage {
  protected readonly username = signal('');
  protected readonly error = signal<string | null>(null);
  protected onSubmit(event: Event): void { ... }
}
```

- **`@Component({...})`** is a *decorator* — metadata that tells Angular "this class is a component".
- **`standalone`:** In Angular 21 every component is standalone by default. It lists what it
  needs in `imports` itself. (Older Angular used `NgModule`s; this project has none.) If the
  template uses `<tui-theme-toggle />` and `ThemeToggle` isn't in `imports`, it won't compile.
- **`protected`** members are visible to the template but not to outside code. The template can't
  see `private` members.
- **Style scoping:** CSS in `login-page.css` only applies to this component. But note: most of the
  look comes from the *global* `spark-admin.css` (see §14).

### 5.1b How the class and template connect

The class holds **state and handlers**; the template **displays state and calls handlers**.
Simplified from `login-page.ts` / `login-page.html`:

```ts
// class
username = signal('');
registered = signal(false);
onUsernameInput(e: Event) { this.username.set(e.target.value); }
```
```html
<!-- template -->
<input [value]="username()" (input)="onUsernameInput($event)">
@if (registered()) { <div class="alert">Account created.</div> }
```

1. **Class → screen.** Calling `username()` inside the template displays the value *and* tells
   Angular "this spot depends on `username`".
2. **Screen → class.** Typing fires `(input)`, which calls `onUsernameInput`, which calls
   `username.set(...)`.
3. **Redraw.** Because of step 1, Angular updates only the bindings that read `username`; it
   doesn't re-check the whole page.

Other details worth knowing:
- **Where the tag name is used.** `selector: 'tui-login-page'` is the tag you *could* write in
  another template. Here the router loads the page, so nobody types it. Small components such
  as `ToastContainer` are used as tags (`<tui-toast-container />` in the shell).
- **`imports` is a strict list.** Anything the template uses (components, `routerLink`, pipes)
  must be listed, or the build fails. That's what "standalone" means; there are no NgModules.
- **Inline vs. file templates.** Most components use `templateUrl`; tiny ones (`ToastContainer`,
  `App`) put the HTML in `template:` inside the decorator.
- **`protected` vs `private`.** Template can read `protected` members but not `private` ones,
  which is why almost everything the template touches is `protected readonly`.
- **When the class is created.** Angular builds one instance each time the component appears on
  screen, running the constructor in an *injection context*, which is why `inject()` and
  `effect()` can be used there (§6, §7).

### 5.2 Template syntax — the five things you need

The template is HTML with a few extras. Real examples:

| Syntax | Name | Meaning | Example in repo |
|---|---|---|---|
| `{{ expr }}` | Interpolation | Print a value as text | `{{ toast.message }}` |
| `[prop]="expr"` | Property binding | Set a DOM property/attribute from a value | `[value]="username()"`, `[class.was-validated]="submitted()"` |
| `(event)="handler()"` | Event binding | Run code when something happens | `(submit)="onSubmit($event)"`, `(click)="retry()"` |
| `@if (...) { } @else { }` | Control flow | Show/hide blocks | `@if (registered()) { <div class="alert">…</div> }` |
| `@for (x of list; track x.id) { }` | Control flow | Repeat a block | `@for (toast of store.toasts(); track toast.id)` |

Notes:
- **Signals are called like functions** in templates: `username()`, not `username`. Calling it is
  how Angular learns "this template depends on that signal".
- **`track`** in `@for` tells Angular how to recognise "the same item" between renders, so it
  moves DOM nodes instead of rebuilding them. It's required.
- `@if (accountId() === null) { … } @else if (state() === 'failed') { … } @else { … }` — see
  `portfolio-page.html`; this is the standard "no account / error / content" pattern used on most
  pages.
- `@if (updatedAt(); as when) { … }` — evaluate, and if truthy, give it the local name `when`.
- `data-testid="..."` attributes exist purely so tests can find elements.

### 5.3 Why this matters in the review

A reviewer reading a template is checking: does it only read signals (no heavy logic)? Are
`@for` loops tracked? Is there an accessibility attribute (`role="alert"`, `aria-label`) where
needed? You'll see these done consistently (e.g. `toast-container.ts` has `aria-live="polite"`).

---

## 6. Signals

### 6.1 The three building blocks

```ts
const count = signal(0);                     // a box holding a value
count.set(5);                                // replace it
count.update(n => n + 1);                    // change it based on the old value
count();                                     // READ it (call it like a function)

const double = computed(() => count() * 2);  // derived value, recalculated only when count changes

effect(() => { console.log(count()); });     // runs whenever a signal it read changes
```

- **`signal`** — writable state.
- **`computed`** — read-only value derived from other signals. Cached; recalculates lazily.
- **`effect`** — a *side effect* that re-runs when its dependencies change (touch the DOM, call an API, write to storage).
- **`.asReadonly()`** — hand out a version others can read but not set (see `ThemeService.theme`).

### 6.2 A real chain: the order ticket

In `features/orders/order-ticket-page.ts`, the typed quantity flows through computed signals:

```
quantityText (signal) ─► quantity (computed: parse to number)
selected quote (computed) ─► currentPrice ─► estimatedTotal (computed)
side + quote ─► referencePrice ─► protectedLimit ─► maxBuyCost
quantity + holdings + balance + maxBuyCost ─► blocker (computed: the reason you can't submit)
                                              └─► canSubmit() ─► the button's disabled state
```

Nobody writes "when quantity changes, recompute total". Each `computed` declares what it depends on
and Angular wires it up. This is the main reason signals are used.

### 6.3 `effect` and `untracked` — the part that confuses people

Look at the pattern repeated in `shell.ts`, `dashboard-page.ts`, `order-ticket-page.ts`:

```ts
effect(() => {
  const accountId = this.accountId();          // read: this is the dependency
  untracked(() => this.loadAccountData(accountId));   // do work, but DON'T track what it reads
});
```

An effect re-runs when *any* signal it reads changes. `loadAccountData` internally reads other
signals (e.g. `this.balance()`); without `untracked`, the effect would also re-run whenever
*those* change, causing loops or duplicate API calls. `untracked` says "only `accountId` should
trigger this".

### 6.4 Signals vs RxJS — when each is used here

- **Signals** = *current state the screen shows* (what is the balance now?).
- **Observables** (RxJS) = *things that happen over time* (an HTTP response, a timer tick).
- The bridge: you `subscribe` to an observable and `.set()` a signal in the callback. You'll see
  this everywhere, e.g. `this.balance.set(balance)`.

---

## 7. Dependency injection and stores

### 7.1 The problem it solves

`LoginPage`, the auth guard, the HTTP interceptor and the shell all need to agree on one fact:
*is the user signed in, and what is the token?* There must be **one** object holding that answer.
If each class created its own, the login page would store the token in its copy, and the guard
would look in an empty one and bounce the user back to login.

You could create one object and pass it from class to class by hand, but that gets messy fast.
**Dependency injection (DI)** fixes it: you don't create or pass the object, you **ask Angular
for it**, and Angular hands you the shared one.

*Analogy:* a kitchen has one shared recipe book. You ask the waiter (Angular) for it; you don't
buy your own copy. The waiter creates it the first time anyone asks, then reuses it.

### 7.2 The two lines that do it

**1. Declare that it can be shared** (`session.store.ts`):
```ts
@Injectable({ providedIn: 'root' })
export class SessionStore { ... }
```
- `@Injectable` = Angular may create and hand out this class.
- `providedIn: 'root'` = make **one** instance for the whole app.

**2. Ask for it** (in any class):
```ts
private readonly session = inject(SessionStore);
```
Every class that writes this gets the **same object**.

**What this buys at sign-in**, with nothing passed around by hand:
1. `LoginPage` calls `session.signIn(...)`, which sets signals inside the store.
2. The guard calls `session.isSignedIn()` and sees `true` immediately.
3. The interceptor reads `session.accessToken()` for the next request.
4. The shell's effect sees `isSignedIn` change and starts loading the profile and notifications.

### 7.3 What a "store" is

A **store** is not a special Angular feature. It is an ordinary `@Injectable({ providedIn: 'root' })`
class that (1) **holds state in signals** and (2) **exposes methods** to change it safely.

```ts
private readonly token = signal<string | null>(null);        // private: only the store sets it
readonly isSignedIn = computed(() => this.token() !== null); // public: anyone may read
signIn(...) { ... }    signOut() { ... }                     // the only ways to change it
```

The signal holding the token is `private`. Everyone else reads through `isSignedIn()` and
`accessToken()` and changes things only through `signIn`/`signOut`. That keeps all the rules
(saving to `localStorage`, decoding `accountId` from the JWT) in one place.

| Store | What it remembers | Persists in | Used by |
|---|---|---|---|
| `SessionStore` | access token, refresh token, accountId, `isSignedIn` | `localStorage` (`trading-ui.session`) | login, guard, interceptor, shell, most pages |
| `UserProfileStore` | name, email, phone | memory | shell, My Account |
| `NotificationStore` | bell list, toasts, unread count; polls every 10 s | read-IDs in `localStorage` | shell, dashboard, order page |
| `ThemeService` | light/dark | `localStorage` | app root, charts |
| `ReturnUrlStore` | page you were heading to before login | memory | guard, login |

The shell ties them together with one effect (`shell.ts`): when the session changes, start or stop
loading the profile and polling notifications. **The session drives everything.**

### 7.4 `InjectionToken`: sharing things that aren't classes

`inject(SessionStore)` works because `SessionStore` is a class. The store also needs the browser's
`localStorage`, which isn't a class you wrote. An `InjectionToken` is a **named slot** for it:

```ts
export const LOCAL_STORAGE = new InjectionToken<Storage>(
  'Storage for sessions',
  { factory: () => localStorage }     // default: fill the slot with the real localStorage
);

// inside SessionStore:
private readonly store = inject(LOCAL_STORAGE);
```

The store doesn't say "use `localStorage`"; it says "give me whatever fills the `LOCAL_STORAGE`
slot". In the real app that's the browser's storage. In a test the slot can hold a fake in-memory
object, so no test touches real browser storage or affects another. The project does the same for
timing: `NOTIFICATION_POLL_MS` is 10 s in production but tests can set it tiny, and
`THEME_STORAGE` works like `LOCAL_STORAGE`.

### 7.5 `inject()` also works in functions, with one rule

The guard and interceptor are plain functions, and they use `inject` too:
```ts
export const authGuard: CanActivateFn = () => { const session = inject(SessionStore); ... };
```
**Rule:** `inject` only works *while Angular is running that code*: in a constructor, a field
initializer, or at the top of a guard/interceptor, **not later inside a callback**. That's why
`bearer.interceptor.ts` calls `inject(AuthService)` up front ("not once RxJS calls back").

### 7.6 Why not just a global variable?

`export const session = new SessionStore()` would also share one object. DI additionally gives you:
1. **Testing:** swap in a fake without editing code.
2. **Controlled creation:** created only when first asked for, with its own dependencies
   (like `LOCAL_STORAGE`) filled in automatically.
3. **A shared convention:** anyone who knows Angular reads `inject(...)` as "shared dependency".

**One-sentence review answer:** "Shared state lives in root-provided stores obtained with
`inject()`, so there's one session for the whole app; browser storage and timers come in through
`InjectionToken`s so tests can replace them."

---

## 8. Routing, lazy loading and guards

### 8.1 The route table

`app.routes.ts` is an array of `{ path, component, ... }`. Simplified:

```
/                  → LandingPage                  (public)
/login             → LoginPage                    (public)
/register   (public)
/app               → Shell   (guarded)            ← the frame: sidebar + top bar
   /app/dashboard      → DashboardPage             (rendered INSIDE the Shell's <router-outlet>)
   /app/portfolio, /orders, /blotter, /account, /settings, /bank-accounts
/dashboard, /orders, … → redirect to /app/…       (legacy URLs)
**                 → redirect to /                (anything unknown → landing page)
```

**Nested routes / layout routes:** `Shell` has its own `<router-outlet>`. `/app/dashboard`
renders `Shell` first, then puts `DashboardPage` in Shell's outlet. That's how the sidebar stays
put while pages change. Public pages like login are siblings, so they get no sidebar.

### 8.2 Lazy loading

```ts
loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage)
```
The `import(...)` means the dashboard's code is **not** in the first download; it's fetched the
first time someone visits. That keeps the initial bundle small (808 kB now; the build warns at
850 kB and errors at 1.5 MB — see `angular.json` budgets). You can see the lazy chunks in the
build output (`blotter-page`, `order-ticket-page`, …).

### 8.3 Guards

A **guard** is a function the router runs before entering a route. Return `true` to allow, or a
`UrlTree` (a redirect instruction) to send the user elsewhere.

```ts
export const authGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionStore);
  ...
  if (session.isSignedIn()) return true;
  const destination = returnUrl.capture(state.url);
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: destination } });
};
```

- `canActivate: [authGuard]` runs when entering `/app`.
- `canActivateChild: [authGuardChild]` runs again when moving *between* the children — so if the
  session ends while the app is open, the next click is blocked.
- **Important statement for the review** (it's in the guard's own comment): this guard is a
  *usability* control, not security. Anyone can read the JavaScript bundle. Real authorization is
  the backend rejecting calls without a valid token.

### 8.4 The "return URL" flow and the open-redirect protection

1. Signed-out user opens `/app/orders`.
2. Guard blocks, sends them to `/login?returnUrl=%2Fapp%2Forders`.
3. After successful login, `LoginPage` calls `returnUrl.consume(...)` and navigates to it.

`sanitiseReturnUrl` in `return-url.ts` is the security-relevant bit. If it just trusted the
query string, an attacker could send `/login?returnUrl=https://evil.example`, and after the user
types their password they'd be bounced to a look-alike site. So it only accepts paths that start
with a single `/`, with no backslashes, control characters, or `//`. This has its own tests
(`return-url.spec.ts`).

### 8.5 `routerLink` and `routerLinkActive`

`<a routerLink="/app/dashboard">` navigates without a page reload. `routerLinkActive="active"`
adds the CSS class `active` when the link matches the current URL — used for the sidebar highlight.
**Review issue #1 lives here:** the sidebar links point at the old `/dashboard` URLs while real
routes are `/app/dashboard` (see §18).

---

## 9. Talking to the backend

### 9.1 The pieces

```
Component ──calls──► Generated client method (e.g. AccountsService.getBalance)
                         │ uses
                         ▼
                     HttpClient  ──► [ bearerInterceptor ] ──► network ──► backend
```

### 9.2 Generated clients (`src/app/generated/`)

The backend teams publish API contracts (`Application/Contracts/api-schemas/*.yaml`, "OpenAPI
specs"). `npm run generate:clients` feeds them to OpenAPI Generator, which **writes** TypeScript:
- **models** (`orderResponse.ts` etc.) — the exact shape of each JSON object
- **services** (`orders.service.ts`, `accounts.service.ts`, `auth.service.ts` …) — one method per endpoint

*Why:* the compiler then catches it if the frontend and backend disagree about a field name.
Nobody hand-writes URLs or copies types. *Cost:* the files are huge and noisy, you must never
edit them by hand (changes get overwritten), and the generator needs Java.

Usage in a component:
```ts
this.orders.placeOrder({ placeOrderRequest: { accountId, symbol, side, quantity, price, idempotencyKey } }, 'response')
```

### 9.3 Hand-written services (`core/services/`)

Three routes exist on the backend but not in the contract, so the client wasn't generated:
`MarketService` (quotes/candles), `PortfolioService`, `BankAccountReaderService`. They use
`HttpClient` directly and read the base URL from the generated `Configuration`. Each file's
comment says "delete this when the contract gains the route". A reviewer may ask why the
contract and backend have drifted — that's a team question, not a frontend bug.

### 9.4 Interceptors — middleware for every request

An interceptor is a function that sees every outgoing request and every response/error.
`bearer.interceptor.ts` does two jobs:

**Job 1 — attach the token.** Every request except the public auth endpoints gets
`Authorization: Bearer <accessToken>`. (Login, register, refresh etc. are on a skip-list
because they must be anonymous.)

**Job 2 — renew an expired token and retry.** Access tokens live 15 minutes. When any request
gets a **401**:

```
request ─► 401
   │
   ├─ no refresh token?  ─► end session (sign out, go to /login)
   │
   └─ call POST /auth/refresh  (ONE shared call, even if 5 requests all got 401 at once)
          │
          ├─ success: store new tokens, RETRY the original request once
          │              └─ retry still 401? ─► end session
          └─ failure ─► end session
   (any non-401 error, e.g. 500 or network down ─► passed through untouched; never sign out)
```

**Why the "one shared call" (`renewOnce` + `shareReplay`)?** The auth service uses *rotating*
refresh tokens: using a refresh token revokes it and issues a new one. If two renewals ran at the
same time, the second would present an already-spent token, which the server treats as *theft* and
revokes **every** session for that user. So the code keeps one in-flight renewal in a module
variable and makes concurrent callers join it. That is the most subtle code in the project; the
comments are worth reading and the spec (`bearer.interceptor.spec.ts`, 331 lines) tests it.

### 9.5 Error handling

Backend errors come as `{ errorCode, message }`. `core/errors/error-catalog.ts` maps
`errorCode` → a human-friendly sentence (`'ORD-400'` → "There is not enough cash…"). The rule in
its comments: **branch on `errorCode`, never on HTTP status alone**, because one status (404/409)
can mean several different things.

---

## 10. RxJS

An **Observable** is like a promise that can deliver *many* values over time, and does nothing
until someone **subscribes**. Angular's `HttpClient` returns Observables.

```ts
this.accounts.getBalance({ id }).subscribe({
  next:  (balance) => this.balance.set(balance),   // got a value
  error: (err)     => ...,                          // it failed
  complete: ()     => ...                           // it finished
});
```

An HTTP observable emits once then completes. A `timer(0, 10_000)` emits every 10 s forever
(until unsubscribed).

### 10.1 Operators used in this project

You build pipelines with `.pipe(operator, operator, …)`:

| Operator | What it does | Where |
|---|---|---|
| `map` | transform each value | interceptor, blotter service |
| `catchError` | turn an error into a fallback value (e.g. `of(null)`) so the stream survives | polling code everywhere |
| `switchMap` | for each incoming value, start a new inner observable and **cancel the previous one** | polling: each tick starts a fetch |
| `forkJoin` | run several requests in parallel, emit once when all finish | `loadAccountData`, `UserProfileStore.load` |
| `timer(0, N)` | emit now, then every N ms | all polling |
| `shareReplay` | let many subscribers share one execution, and replay the result | the single-flight token refresh |
| `finalize` | run code when the stream ends either way | clearing `renewalInFlight` |
| `takeWhile(pred, true)` | keep going while true; `true` = also emit the last one | blotter's "poll until no NEW orders" |
| `takeUntil` / `takeUntilDestroyed()` | stop automatically (on a signal / when component dies) | blotter service, navbar |
| `throwError`, `of` | make an error / a value observable | interceptor |

### 10.2 The polling pattern (used 4 times)

```ts
timer(0, 30_000).pipe(
  switchMap(() => this.marketApi.getQuotes().pipe(catchError(() => of(null))))
).subscribe(quotes => { if (quotes === null) {/* keep old data, mark failed */} else {...} });
```
Read as: "now and every 30 s, fetch quotes; if a fetch fails, produce `null` instead of killing the
timer; if the previous fetch is still running, cancel it".

Used for: market quotes (30 s), dashboard (60 s), notifications (10 s), blotter (2 s, bounded).

### 10.3 The memory-leak rule

A subscription to a long-lived stream keeps running after the page is gone unless you stop it.
So you'll see `ngOnDestroy() { this.subscription?.unsubscribe(); }` or `takeUntilDestroyed()`.
HTTP calls complete by themselves so they don't need this. When reviewing, ask of every
`timer`/`interval`: *who unsubscribes?*

---

## 11. Forms

Angular has two approaches; **both are used here**, which a reviewer may mention.

**A) Plain signals + native events (login page).** Each input has `[value]="username()"` and
`(input)="onUsernameInput($event)"`; the handler does `username.set(...)`. Simple, no forms library.

**B) Reactive Forms (order ticket, bank page).** `FormBuilder` creates a `FormGroup`; each
control has *validators*:
```ts
transferForm = this.formBuilder.nonNullable.group({
  amount: ['', [Validators.required, Validators.min(0.01), Validators.pattern(MONEY_PATTERN)]]
});
```
The template binds with `[formGroup]` / `formControlName`. `form.invalid`, `control.touched`,
`control.errors` drive error messages. Custom validators are plain functions
(`wholeQuantity` in `order-validators.ts`).

**Important principle (stated in the code):** client validation is a *convenience*, not
enforcement. The backend re-checks every rule. The form exists "so the obvious mistakes never reach
the wire".

---

## 12. Lifecycle and cleanup

Angular creates a component, shows it, and later destroys it. Hooks:

| Hook | When | Used for here |
|---|---|---|
| `constructor` | object created; **injection context is valid** (can call `inject`, `effect`) | set up effects, start polling |
| `ngOnInit` | after inputs set | blotter starts polling; shell registers listeners |
| `ngAfterViewInit` | template is in the DOM | **create ApexCharts** (needs a real element) |
| `ngOnDestroy` | about to be removed | unsubscribe timers, `chart.destroy()`, remove `document` listeners, remove classes from `<body>` |

`viewChild.required<ElementRef>('orderFlowChart')` grabs a reference to an element marked `#orderFlowChart`
in the template. Charts are third-party and not "Angular-aware", so the code creates them manually and must
destroy them manually.

---

## 13. End-to-end flows

### 13.1 Sign-in

1. User types username/password → `onUsernameInput` → signals updated.
2. Submit → `LoginPage.onSubmit` → `auth.login({ loginRequest })` (generated client → POST `/auth/login`; interceptor skips it, public).
3. Success → `session.signIn(accessToken, null, refreshToken)`:
   - sets three signals, decodes `accountId` out of the JWT payload, writes to `localStorage`.
4. `returnUrl.consume(...)` → `router.navigateByUrl(destination)` (default `/dashboard` → redirects to `/app/dashboard`).
5. Guard sees `isSignedIn()` true → `Shell` renders → its effect starts `UserProfileStore.load` and `NotificationStore.start`.
6. Failure → `ErrorCatalog.messageForSignIn` produces a deliberately vague message ("username or password not recognised") so attackers can't tell which was wrong.

### 13.2 Opening a protected page while signed out

`/app/orders` → `authGuard` → no session → redirect to `/login?returnUrl=/app/orders` → after login lands on orders.

### 13.3 Placing an order

1. Page loads → quotes polled every 30 s; account data (balance, holdings) loaded via `forkJoin`.
2. User picks BUY/SELL and enters a quantity → computed signals produce estimated total and `blocker`.
3. **No price input**: orders execute at market. But the API requires a `price`, so the page sends a *protective limit*: the ask (buy) / bid (sell) padded 2 % in the trader's unfavourable direction (`PRICE_PROTECTION = 0.02`). Purpose: a small price move between click and fill shouldn't reject the order; the executor still fills at the live price, never at the limit.
4. Submit → `placeOrder` with a fresh `idempotencyKey` (UUID).
5. Success → show "accepted" summary, reset the form, reload balance/holdings, call `notifications.refresh()`.
6. A few seconds later the order fills; the notification poll sees a new item → bumps `notifications.changes` → the dashboard, orders page etc. have effects watching `changes` and **reload**. This is how pages update without a push channel.
7. Failure → `OrderErrorMessages.forOrderFailure` maps `errorCode` to text.

### 13.4 Linking a bank account (the trickiest flow)

1. A new user has a token with **no `accountId` claim**; pages show "link a bank account".
2. `onLinkSubmit` → `OnboardingService.linkBankAccount` → backend creates the trading account.
3. The token in hand is now stale (doesn't carry the new `accountId`), so the page calls
   `auth.refresh(...)` and `session.adoptTokens(newToken, linked.accountId, newRefresh)`.
4. `session.accountId` changes → Shell's effect restarts notifications/profile; the page reloads balances.

### 13.5 Notifications

`NotificationStore.start(accountId)` → `timer(0, 10s)` + `switchMap` fetch. First poll: remember
everything as "seen" (no flood of pop-ups for old items). Later polls: anything unseen → toast (if
enabled) and `changes++`. "Read" state is remembered per account in `localStorage`.

### 13.6 Theme

`ThemeService` signal → an `effect` sets `data-bs-theme="dark|light"` on `<html>`. CSS reacts to
that attribute. Charts read their colours from `chart-theme.ts` and redraw when `isDark()` changes.

---

## 14. Styling and theming

- Global CSS loaded by `angular.json`: Bootstrap, bootstrap-icons, apexcharts, **`spark-admin.css`**
  (a purchased/free admin template's design system, 4,165 lines), then `styles.css`.
- **Component CSS is scoped** (Angular adds unique attributes so it only affects that component).
  Most component CSS files are tiny because shared classes (`.card`, `.btn-custom-primary`,
  `.badge-table`) live globally. The rule in `AGENTS.md`: reuse the global classes; don't write new
  one-off CSS.
- **Dark mode:** `html[data-bs-theme="dark"]` overrides in the global file. Scoped component CSS
  can't be overridden from outside, so the blotter (which hard-codes colours) carries its own
  `:host-context([data-bs-theme="dark"])` rules.
- **Budgets:** `anyComponentStyle` warns at 14 kB and errors at 16 kB per component stylesheet.

---

## 15. Testing

**Unit/component tests — Vitest + TestBed** (`npm test`). Results I got when preparing this:
**35 files, 488 tests, all passing.**

- `TestBed` builds a mini Angular app for a test and lets you create a component or inject a service.
- `HttpTestingController` intercepts HTTP so no real network. `testing/fake-api.ts` wraps it:
  register what each URL answers, create the component, call `flush()` to deliver answers.
  An **unregistered request fails the test** — deliberate, so surprise API calls are caught.
- Polling code uses `vi.useFakeTimers()` to jump time forward.
- `test-setup.ts` clears `localStorage`/`sessionStorage` before every test (since sessions now
  persist) and stubs `ResizeObserver` (missing in jsdom, needed by ApexCharts).
- Guards/interceptors are tested by running them in an injection context
  (`TestBed.runInInjectionContext`).

**End-to-end — Playwright** (`e2e/`, `npm run test:e2e`). Real browser, real backend. Needs the
whole stack running and test credentials (`.env.test.example`). I did not run these.

---

## 16. Build, config and commands

```bash
npm ci                       # install exact versions from package-lock.json
npm run generate:clients     # regenerate API clients (needs Java)
npm start                    # dev server http://localhost:4200
npm run build                # production build → dist/trading-ui
npm test -- --watch=false    # unit tests once
npm run test:e2e             # Playwright
```

- **`angular.json`** — build target, global styles, size budgets, test setup file.
- **`tsconfig.json`** — `strict`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`…; Angular's
  `strictTemplates` also type-checks the HTML templates.
- **Production vs dev builds** — production minifies and hashes file names; budgets apply.
- **Base URLs are hard-coded** in `app.config.ts` (`localhost:3000`, `localhost:8081`). There is no
  per-environment config, so a deployed build can't change them without editing code.

---

## 17. Design decisions

| Decision | Why (according to the code/comments) | Trade-off to be aware of |
|---|---|---|
| Standalone components + signals + zoneless | Modern Angular default; fine-grained updates; less magic | Must remember to use signals; plain properties mutated in callbacks won't update the view |
| Session in `localStorage` | Survives reload/restart/new tabs | Tokens readable by any JS on the page (XSS risk); fine for a capstone, worth naming |
| Guard is "usability, not security" | The bundle is public; the API enforces access | Don't claim the guard protects data |
| Refresh-on-401 in an interceptor with single-flight | One place handles expiry for every call; avoids tripping token-theft detection | Subtle; everything that refreshes should go through it (see issue #2) |
| Generated API clients | Types always match the contract | Large noisy generated files; needs Java; some routes missing from contract |
| Hand-written services for missing routes | Unblocks UI | Contract/back end drift; each is marked "delete when contract grows" |
| Market orders with a protective limit | Backend requires price; trader shouldn't be rejected by small moves | Can cost up to 2 % worse than quoted in a fast market only as a ceiling; executor fills at live price |
| Polling instead of push | No websocket/SSE available | Latency (≤10 s), extra traffic; pages reload on the `changes` counter |
| Global design-system CSS | Consistent look, template-driven | 4k-line global file; dark-mode special cases |
| Client validation mirrors server rules | Fast feedback | Duplicated rules can drift; server remains the authority |
| Error codes mapped in a catalog | Trader-friendly, branch on `errorCode` | Catalog must track the contract (see issue #5) |
| `InjectionToken`s for storage/timers | Testable | A little more ceremony |

---

## 18. Code-review prep

### 18.1 Health snapshot (what I verified)

- `npm ci --ignore-scripts` ✔, `ng build` (production) ✔ — initial bundle **808 kB** (warning 850 kB).
- `ng test` ✔ — **35 files / 488 tests passing**.
- No `innerHTML`, `bypassSecurityTrust*`, or `eval` use in app code.
- Playwright e2e **not run** (needs backend).

### 18.2 Issues a reviewer is likely to raise (plain-English)

**1. Old URLs still used in links (caused by the restructure).**
Routes moved under `/app/...`, but `shell.html`, dashboard, portfolio, account, `navbar-search.ts`
and `return-url.store.ts` still use `/dashboard`, `/orders`, `/blotter`, … The redirects in
`app.routes.ts` make clicks still work, but `routerLinkActive` compares URLs and the final URL is
`/app/dashboard`, so the sidebar's highlight likely doesn't show (not confirmed in a browser).
*Fix:* change links to `/app/...`.

**2. Bank page refreshes the token outside the interceptor's safe path.**
`bank-account-page.ts → adoptRefreshedSession` calls `auth.refresh()` directly. §9.4 explains why
two simultaneous refreshes can log the user out everywhere. The 10-second notification poll could
collide. *Fix:* export and reuse the single-flight renewal.

**3. Idempotency keys are regenerated on every click.**
An idempotency key's whole purpose is "if I retry the *same* action, don't do it twice". A fresh
UUID per submit means a timeout-then-retry could create a second order/transfer. The only
double-click protection is the `submitting` flag. *Fix:* generate one key per attempt-intent and
reuse it until inputs change.

**4. Console logging of financial data in the bank page.**
Account numbers, bank details, transfer responses are `console.info`'d. The order page explicitly
promises *not* to log such things. 30 `console.*` calls across the app.

**5. Error codes don't match the contract.**
Bank page handles `FUND-402`/`ACC-402`, which aren't in `trade-api.yaml` (insufficient funds is
`TRF-400`), so that branch is dead. `ACC-409` isn't in `error-catalog.ts`. Messages are defined in
two places.

**6. Blotter inconsistencies.**
- Stores dates already formatted as "Feb 14, 2026" then re-parses them to sort → same-day orders
  aren't ordered by time.
- Hard-codes `₹` and `en-US` locale while the rest of the app uses `formatMoney` (INR, `en-IN`).
- Polling stops after ~30 s; ignores the notification `changes` signal other pages use.
- One failed poll ends the stream.
- Different code style (public members, `CommonModule`, constructor injection, trailing spaces).

**7. Possible stale identity after sign-out.**
`UserProfileStore.load()` can't be cancelled. If a request is in flight at sign-out, its late
response re-fills the previous user's name/email.

**8. Smaller.**
Hard-coded `localhost` base URLs; no request cancellation on overlapping loads; an orphaned comment
in `order-ticket-page.ts`; bank page defaults `walletCurrency` to `'USD'`; a 401 from `/auth/logout`
after local sign-out adds a stray `returnUrl`.

### 18.3 Repo hygiene a reviewer may raise

- Generated clients are **committed** (with `git_push.sh`, `package.json` etc.) *and* regenerated by `postinstall`.
- `AGENTS.md` is partly stale (old route names, "3187 lines" for the CSS file that is 4,165).
- The branch diff vs `main` is huge (797 files) because of the restructure into `Application/`.
  Be ready to explain what to look at (this frontend lives under `Application/Frontend/frontend-app`).

### 18.4 Questions you might be asked, and short answers

| Question | Answer |
|---|---|
| "Why signals instead of just variables?" | The app is zoneless; signals are how Angular knows what to redraw. `computed` keeps derived values (total, blocker) automatically correct. |
| "What does the auth guard protect?" | Nothing security-wise; it avoids showing a broken page to signed-out users. The API enforces auth on every call. |
| "Why store tokens in localStorage?" | So sessions survive reloads/tabs. Trade-off: readable by injected JS; mitigated by no `innerHTML` use and short-lived (15 min) access tokens. |
| "What happens if two requests 401 at once?" | One shared refresh call; both retry with the new token (`renewOnce`). Prevents rotating-token theft detection from logging the user out. |
| "How does the UI learn an order filled?" | It doesn't get pushed. Notification polling (10 s) detects a new event and bumps `changes`; pages with effects on `changes` reload. |
| "Why is there no price field on the order form?" | Orders are market orders; the protective limit (±2 %) is sent because the API requires a price. |
| "Why is `app.routes.ts` full of redirects?" | Legacy `/dashboard`-style URLs from before the move to `/app/*`. They keep old bookmarks working. |
| "Why generated API code?" | Types stay in sync with the contract. |
| "Why are some services hand-written?" | The contract lacks those routes; each file says to delete it when the contract is updated. |
| "How is it tested?" | 488 Vitest tests with a fake backend; Playwright e2e for flows; the interceptor and guard have dedicated specs. |

---

## 19. Glossary

- **SPA** — single-page application: one page load, then JS swaps content.
- **Component** — class + template + styles; a custom HTML tag.
- **Standalone** — a component that declares its own `imports`; no NgModule.
- **Decorator** — `@Component(...)`, `@Injectable(...)`: metadata attached to a class.
- **Template** — the component's HTML, with bindings and `@if`/`@for`.
- **Binding** — `{{ }}`, `[prop]`, `(event)`: the link between class and template.
- **Signal** — a value that notifies readers when it changes. `computed` = derived; `effect` = side effect.
- **Zoneless** — Angular without zone.js; relies on signals for change detection.
- **Change detection** — Angular's process for deciding what to re-render.
- **Dependency Injection (DI)** — asking Angular for objects with `inject()` instead of creating them.
- **Provider** — a rule telling DI how to create something (`providedIn: 'root'`, `provideRouter(...)`).
- **InjectionToken** — a named DI slot for non-class values (e.g. `localStorage`).
- **Service / Store** — an injectable class holding logic or state.
- **Router / route / outlet** — maps URLs to components; `<router-outlet>` is where the matched component is drawn.
- **Lazy loading** — fetching a page's code only when first visited.
- **Guard** — a function that allows or redirects a navigation.
- **UrlTree** — a router redirect instruction returned by a guard.
- **Interceptor** — a function that sees every HTTP request/response.
- **Observable** — a stream of values over time; does nothing until subscribed.
- **Operator** — a function used in `.pipe()` to transform an observable.
- **Subscribe / unsubscribe** — start/stop receiving values; unsubscribe long-lived ones to avoid leaks.
- **Reactive Forms** — forms defined in code with `FormBuilder`, controls and validators.
- **Lifecycle hook** — `ngOnInit`, `ngAfterViewInit`, `ngOnDestroy`: callbacks at stages of a component's life.
- **JWT** — JSON Web Token: the access token; its payload carries claims such as `accountId`.
- **Refresh token / rotation** — long-lived token used to get a new access token; each use replaces it.
- **Idempotency key** — a client-chosen ID so a retried request isn't executed twice.
- **OpenAPI** — a YAML description of an API from which clients can be generated.
- **TestBed** — Angular's testing harness. **Vitest** — the test runner. **Playwright** — browser automation.
- **Bundle / chunk / budget** — the built JS files; lazy chunks load on demand; budgets cap their size.
