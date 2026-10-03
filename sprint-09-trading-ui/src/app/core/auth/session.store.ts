import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';

/**
 * The backing store for a tab-lifecycle session. The seam Samyukhtha's guard
 * and the order ticket are written against was this class's public surface;
 * the tokens below reach past it only on purpose. The strings stored here are
 * exactly the wire tokens - the JWT itself and the opaque refresh token.
 */
export const SESSION_STORAGE = new InjectionToken<Storage>(
  'Storage for tab-lifecycle sessions',
  { factory: () => sessionStorage }
);

/** The backing store for a remembered session that survives a restart. */
export const LOCAL_STORAGE = new InjectionToken<Storage>(
  'Storage for remembered sessions',
  { factory: () => localStorage }
);

/** What actually gets written to storage. `remembered` is stored so a future
 *  boot knows where the entry came from. */
interface PersistedSession {
  accessToken: string;
  refreshToken: string | null;
  accountId: number | null;
  remembered: boolean;
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
 * taken on every call.
 *
 * Sessions are checkbox-driven: `remember` (Remember Me) persists across a
 * restart, everything else lives for the tab. Keeping the two apart also
 * means an unchecked sign-in can never resurrect itself later.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly tabStore = inject(SESSION_STORAGE);
  private readonly rememberedStore = inject(LOCAL_STORAGE);

  private readonly token = signal<string | null>(null);
  private readonly refresh = signal<string | null>(null);
  private readonly account = signal<number | null>(null);

  constructor() {
    const remembered = this.readPersisted();
    if (remembered !== null) {
      this.token.set(remembered.accessToken);
      this.refresh.set(remembered.refreshToken);
      this.account.set(remembered.accountId);
    }
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
   *  access token. */
  readonly refreshToken = computed(() => this.refresh());

  /**
   * Records a successful login and hands back control. `accountId` is read
   * from the token's JWT claim when not supplied, so the order ticket and the
   * dashboard stop being hard-coded to a demo account on the next login.
   */
  signIn(
    accessToken: string,
    accountId: number | null = null,
    refreshToken: string | null = null,
    remember = false
  ): void {
    this.token.set(accessToken);
    this.refresh.set(refreshToken);
    this.account.set(accountId ?? decodeAccountId(accessToken));
    this.persist(remember);
  }

  /** Drops the session locally. Called after the auth service has (best
   *  effort) revoked the refresh token; the local wipe is what actually ends the
   *  session in this browser. */
  signOut(): void {
    this.token.set(null);
    this.refresh.set(null);
    this.account.set(null);
    this.clearStores();
  }

  /**
   * Replaces the tokens without touching `remembered`, for the one case that is
   * not a sign-in: claiming a bank account creates the trading account, so the
   * token this session is already holding is stale and has to be exchanged. Going
   * through `signIn` for that would be a lie about what just happened and would
   * quietly drop a "remember me" session down to a tab-only one, so the
   * persistence promise is read back off whichever store already holds the
   * session and re-applied.
   */
  adoptTokens(accessToken: string, accountId: number, refreshToken: string | null): void {
    this.token.set(accessToken);
    this.refresh.set(refreshToken);
    this.account.set(accountId);
    this.persist(this.rememberedStore.getItem(SESSION_KEY) !== null);
  }

  private persist(remembered: boolean): void {
    const entry: PersistedSession = {
      accessToken: this.token() ?? '',
      refreshToken: this.refresh(),
      accountId: this.account(),
      remembered
    };
    try {
      this.rememberedStore.removeItem(SESSION_KEY);
      this.tabStore.removeItem(SESSION_KEY);
      (remembered ? this.rememberedStore : this.tabStore).setItem(
        SESSION_KEY,
        JSON.stringify(entry)
      );
    } catch {
      // Storage can be full, disabled, or unavailable (private browsing).
      // The session still works for this tab; only the persistence promise
      // is dropped, silently, because there is nothing the user can do about
      // it that a sign-in from this tab could not solve.
    }
  }

  /**
   * The session this browser should come back as: the remembered one if there is one, else the
   * one this tab already held. sessionStorage survives a reload of the same tab and dies with the
   * tab, which is exactly the lifetime an unticked "Remember Me" promises, so reading it here
   * keeps a reload from signing someone out without letting a closed tab's session return later.
   */
  private readPersisted(): PersistedSession | null {
    return this.readFrom(this.rememberedStore, true) ?? this.readFrom(this.tabStore, false);
  }

  private readFrom(store: Storage, remembered: boolean): PersistedSession | null {
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
        accountId: typeof parsed.accountId === 'number' ? parsed.accountId : null,
        remembered
      };
    } catch {
      return null;
    }
  }

  private clearStores(): void {
    try {
      this.rememberedStore.removeItem(SESSION_KEY);
      this.tabStore.removeItem(SESSION_KEY);
    } catch {
      // Best effort, same reasoning as `persist`.
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