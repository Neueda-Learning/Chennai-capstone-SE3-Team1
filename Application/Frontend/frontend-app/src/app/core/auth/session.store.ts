import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';

/**
 * The backing store for a session. Every session lives here and nowhere else:
 * a sign-in survives a reload, a restart, and every other tab in the browser,
 * and ends when the trader signs out or the refresh token expires.
 *
 * The seam Samyukhtha's guard and the order ticket are written against was this
 * class's public surface; the tokens below reach past it only on purpose. The
 * strings stored here are exactly the wire tokens - the JWT itself and the
 * opaque refresh token.
 */
export const LOCAL_STORAGE = new InjectionToken<Storage>(
  'Storage for sessions',
  { factory: () => localStorage }
);

/**
 * The tab-lifecycle store this app used while Remember Me existed. Nothing is
 * written here any more. It is still read once at boot, so a session created by
 * the previous build is carried into {@link LOCAL_STORAGE} rather than stranding
 * a signed-in trader at upgrade - and then cleared, so a live refresh token is
 * not left behind in a store the app no longer consults.
 */
export const SESSION_STORAGE = new InjectionToken<Storage>(
  'Legacy tab-lifecycle storage: migrated into LOCAL_STORAGE on boot, then cleared',
  { factory: () => sessionStorage }
);

/** What actually gets written to storage. */
interface PersistedSession {
  accessToken: string;
  refreshToken: string | null;
  accountId: number | null;
}

const SESSION_KEY = 'trading-ui.session';

/**
 * Where the browser keeps the credential material, and the only place that
 * touches storage, the JWT, or the interceptor. Everything else in the app
 * reads the `isSignedIn`/`accountId` surface below.
 *
 * Samyukhtha's note matters here: `isSignedIn` is a usability control, not a
 * security one. It answers "does this browser hold a usable token", not "is
 * this request allowed" - authorisation is the Trade REST API's decision,
 * taken on every call. Whether the access token is still inside its 15 minutes
 * is decided by the bearer interceptor, which renews it on a 401 rather than
 * asking this store about the clock.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly store = inject(LOCAL_STORAGE);
  private readonly legacyStore = inject(SESSION_STORAGE);

  private readonly token = signal<string | null>(null);
  private readonly refresh = signal<string | null>(null);
  private readonly account = signal<number | null>(null);

  constructor() {
    const current = this.readFrom(this.store);
    const legacy = current === null ? this.readFrom(this.legacyStore) : null;
    const restored = current ?? legacy;

    if (restored !== null) {
      this.token.set(restored.accessToken);
      this.refresh.set(restored.refreshToken);
      this.account.set(restored.accountId);
    }
    if (current === null && legacy !== null) {
      // Carried over from the tab-lifecycle build, so upgrade does not sign out.
      this.persist();
    }
    this.clearLegacyStore();
  }

  /** True only while this browser holds a usable access token. */
  readonly isSignedIn = computed(() => this.token() !== null);

  /** The `accountId` JWT claim, or `null` when no bank account is linked yet.
   *  The order ticket renders this read-only; it is never an editable field. */
  readonly accountId = computed(() => this.account());

  /** The access token for the next authenticated call (used by the auth
   *  interceptor story and nothing else). */
  readonly accessToken = computed(() => this.token());

  /** The refresh token, whenever the login handed us one. Kept out of the
   *  `isSignedIn` decision: a session is forward-usable only while it has an
   *  access token. The bearer interceptor needs this to renew on a 401. */
  readonly refreshToken = computed(() => this.refresh());

  /**
   * Records a successful login and hands back control. `accountId` is read
   * from the token's JWT claim when not supplied, so the order ticket and the
   * dashboard stop being hard-coded to a demo account on the next login.
   */
  signIn(accessToken: string, accountId: number | null = null, refreshToken: string | null = null): void {
    this.token.set(accessToken);
    this.refresh.set(refreshToken);
    this.account.set(accountId ?? decodeAccountId(accessToken));
    this.persist();
  }

  /** Drops the session locally. Called after the auth service has (best
   *  effort) revoked the refresh token; the local wipe is what actually ends the
   *  session in this browser. */
  signOut(): void {
    this.token.set(null);
    this.refresh.set(null);
    this.account.set(null);
    this.clearSession();
  }

  /**
   * Replaces the tokens without going through `signIn`, for the two cases that
   * are not a sign-in: the bearer interceptor renewing after a 401, and
   * claiming a bank account, which creates the trading account and so makes the
   * `accountId` claim the session is already holding stale. Routing either
   * through `signIn` would be a lie about what just happened.
   */
  adoptTokens(accessToken: string, accountId: number | null, refreshToken: string | null): void {
    this.token.set(accessToken);
    this.refresh.set(refreshToken);
    this.account.set(accountId ?? decodeAccountId(accessToken));
    this.persist();
  }

  private persist(): void {
    const entry: PersistedSession = {
      accessToken: this.token() ?? '',
      refreshToken: this.refresh(),
      accountId: this.account()
    };
    try {
      this.store.setItem(SESSION_KEY, JSON.stringify(entry));
    } catch {
      // Storage can be full, disabled, or unavailable (private browsing).
      // The session still works for this tab; only the persistence promise
      // is dropped, silently, because there is nothing the user can do about
      // it that a sign-in could not solve.
    }
  }

  private readFrom(store: Storage): PersistedSession | null {
    let raw: string | null;
    try {
      raw = store.getItem(SESSION_KEY);
    } catch {
      return null;
    }
    if (raw === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedSession>;
      if (typeof parsed.accessToken !== 'string' || parsed.accessToken === '') {
        return null;
      }
      return {
        accessToken: parsed.accessToken,
        refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
        accountId: typeof parsed.accountId === 'number' ? parsed.accountId : null
      };
    } catch {
      return null;
    }
  }

  /** Wipes the session from both stores, including the legacy one. */
  private clearSession(): void {
    for (const store of [this.store, this.legacyStore]) {
      try {
        store.removeItem(SESSION_KEY);
      } catch {
        // Best effort, same reasoning as `persist`.
      }
    }
  }

  private clearLegacyStore(): void {
    try {
      this.legacyStore.removeItem(SESSION_KEY);
    } catch {
      // Best effort: nothing depends on this succeeding, and the session the
      // trader actually has is in LOCAL_STORAGE either way.
    }
  }
}

/**
 * Reads the `accountId` claim out of a JWT payload, tolerating tokens that are
 * not JWTs at all (the teammates' specs test with `'token'`). Never throws;
 * an unreadable payload simply means "no account claim".
 */
function decodeAccountId(accessToken: string): number | null {
  const payload = readJwtPayload(accessToken);
  if (payload === null) {
    return null;
  }
  try {
    const accountId = (JSON.parse(payload) as { accountId?: unknown }).accountId;
    return typeof accountId === 'number' ? accountId : null;
  } catch {
    return null;
  }
}

function readJwtPayload(accessToken: string): string | null {
  const segments = accessToken.split('.');
  if (segments.length < 2) {
    return null;
  }
  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    // The payload is base64url-encoded UTF-8; atob gives a binary string, so
    // decode it back to text byte by byte.
    const binary = atob(padded);
    return decodeURIComponent(
      Array.from(binary)
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join('')
    );
  } catch {
    return null;
  }
}