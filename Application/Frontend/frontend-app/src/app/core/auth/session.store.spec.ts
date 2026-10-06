import { TestBed } from '@angular/core/testing';

import { LOCAL_STORAGE, SESSION_STORAGE, SessionStore } from './session.store';

const KEY = 'trading-ui.session';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

class ThrowingStorage extends MemoryStorage {
  override getItem(_key: string): string | null {
    throw new Error('storage unavailable');
  }

  override setItem(_key: string, _value: string): void {
    throw new Error('storage unavailable');
  }

  override removeItem(_key: string): void {
    throw new Error('storage unavailable');
  }
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: string): string =>
    btoa(value)
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${encode(JSON.stringify({ alg: 'HS256' }))}.${encode(JSON.stringify(payload))}.sig`;
}

function createStore(overrides: { session?: Storage; local?: Storage } = {}): SessionStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SESSION_STORAGE, useValue: overrides.session ?? new MemoryStorage() },
      { provide: LOCAL_STORAGE, useValue: overrides.local ?? new MemoryStorage() }
    ]
  });
  return TestBed.inject(SessionStore);
}

function stored(store: Storage): { accessToken?: string; refreshToken?: string | null } {
  const raw = store.getItem(KEY);
  return raw === null ? {} : JSON.parse(raw);
}

describe('SessionStore', () => {
  it('starts signed out with no tokens and no account', () => {
    const store = createStore();
    expect(store.isSignedIn()).toBe(false);
    expect(store.accessToken()).toBeNull();
    expect(store.refreshToken()).toBeNull();
    expect(store.accountId()).toBeNull();
  });

  it('stores the tokens and account it is handed', () => {
    const store = createStore();
    store.signIn('token-1', 42, 'refresh-1');
    expect(store.isSignedIn()).toBe(true);
    expect(store.accessToken()).toBe('token-1');
    expect(store.refreshToken()).toBe('refresh-1');
    expect(store.accountId()).toBe(42);
  });

  it('reads accountId from the JWT claim when it is not handed over', () => {
    const store = createStore();
    store.signIn(jwt({ accountId: 7 }), null, null);
    expect(store.isSignedIn()).toBe(true);
    expect(store.accountId()).toBe(7);
  });

  it('treats a token without an accountId claim as having none', () => {
    const store = createStore();
    store.signIn(jwt({ sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f' }), null, null);
    expect(store.isSignedIn()).toBe(true);
    expect(store.accountId()).toBeNull();
  });

  it('lets an explicit accountId win over the JWT claim', () => {
    const store = createStore();
    store.signIn(jwt({ accountId: 1 }), 42, null);
    expect(store.accountId()).toBe(42);
  });

  it('tolerates a token that is not a JWT at all', () => {
    const store = createStore();
    expect(() => store.signIn('token', null, null)).not.toThrow();
    expect(store.isSignedIn()).toBe(true);
    expect(store.accountId()).toBeNull();
  });

  it('writes the session to localStorage and never to sessionStorage', () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const store = createStore({ session, local });

    store.signIn('token-1', 42, 'refresh-1');

    expect(stored(local).accessToken).toBe('token-1');
    expect(stored(local).refreshToken).toBe('refresh-1');
    expect(session.getItem(KEY)).toBeNull();
  });

  it('a new sign-in replaces the previous one', () => {
    const local = new MemoryStorage();
    const store = createStore({ local });

    store.signIn('token-one', 1, null);
    store.signIn('token-two', 2, null);

    expect(store.accessToken()).toBe('token-two');
    expect(stored(local).accessToken).toBe('token-two');
  });

  it('reads the accountId from a token whose payload encodes to base64url with an underscore', () => {
    const token = jwt({ accountId: 42, n: '???' });
    expect(token.split('.')[1]).toContain('_');

    const store = createStore();
    store.signIn(token);

    expect(store.accountId()).toBe(42);
  });

  it('restores a persisted session on a future boot', () => {
    const local = new MemoryStorage();
    local.setItem(
      KEY,
      JSON.stringify({ accessToken: 'token-persisted', refreshToken: 'refresh-persisted', accountId: 5 })
    );

    const store = createStore({ local });

    expect(store.isSignedIn()).toBe(true);
    expect(store.accessToken()).toBe('token-persisted');
    expect(store.refreshToken()).toBe('refresh-persisted');
    expect(store.accountId()).toBe(5);
  });

  it('migrates a tab-only session from the previous build into localStorage', () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    session.setItem(
      KEY,
      JSON.stringify({ accessToken: 'tab-token', refreshToken: 'tab-refresh', accountId: 3, remembered: false })
    );

    const store = createStore({ session, local });

    expect(store.accessToken()).toBe('tab-token');
    expect(store.refreshToken()).toBe('tab-refresh');
    expect(store.accountId()).toBe(3);
    expect(stored(local).accessToken).toBe('tab-token');
  });

  it('clears the legacy store on boot, so no refresh token is left in it', () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    session.setItem(KEY, JSON.stringify({ accessToken: 'tab-token', refreshToken: 'tab-refresh', accountId: 3 }));

    createStore({ session, local });

    expect(session.getItem(KEY)).toBeNull();
  });

  it('prefers localStorage and clears the legacy entry when both hold one', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem(KEY, JSON.stringify({ accessToken: 'local', refreshToken: null, accountId: 1 }));
    session.setItem(KEY, JSON.stringify({ accessToken: 'legacy', refreshToken: 'legacy-refresh', accountId: 2 }));

    const store = createStore({ local, session });

    expect(store.accessToken()).toBe('local');
    expect(session.getItem(KEY)).toBeNull();
  });

  it('ignores a stored session with no token', () => {
    const local = new MemoryStorage();
    local.setItem(KEY, JSON.stringify({ accessToken: '', refreshToken: null, accountId: 3 }));

    expect(createStore({ local }).isSignedIn()).toBe(false);
  });

  it('ignores unreadable storage content without throwing', () => {
    const local = new MemoryStorage();
    local.setItem(KEY, 'not-json');

    const store = createStore({ local });

    expect(store.isSignedIn()).toBe(false);
  });

  it('still signs in and out when storage throws (private browsing)', () => {
    const store = createStore({
      session: new ThrowingStorage(),
      local: new ThrowingStorage()
    });

    expect(() => store.signIn('token-1', 42, 'refresh-1')).not.toThrow();
    expect(store.isSignedIn()).toBe(true);
    expect(store.accountId()).toBe(42);

    expect(() => store.signOut()).not.toThrow();
    expect(store.isSignedIn()).toBe(false);
    expect(store.accountId()).toBeNull();
  });

  it('adoptTokens replaces the tokens in place, keeping the session', () => {
    const local = new MemoryStorage();
    const store = createStore({ local });

    store.signIn('old-access', 7, 'old-refresh');
    store.adoptTokens('new-access', 7, 'new-refresh');

    expect(store.accessToken()).toBe('new-access');
    expect(store.refreshToken()).toBe('new-refresh');
    expect(store.accountId()).toBe(7);
    expect(stored(local).accessToken).toBe('new-access');
    expect(stored(local).refreshToken).toBe('new-refresh');
  });

  it('adoptTokens falls back to the new token\'s own claim when no account is passed', () => {
    const store = createStore();

    store.adoptTokens(jwt({ accountId: 12 }), null, 'new-refresh');

    expect(store.accountId()).toBe(12);
  });

  it('selectAccount accepts only the account the token was issued for', () => {
    const local = new MemoryStorage();
    const store = createStore({ local });
    store.signIn(jwt({ accountId: 7 }), null, null);

    expect(store.selectAccount(7)).toBe(true);
    expect(store.accountId()).toBe(7);
    expect(store.selectAccount(8)).toBe(false);
    expect(store.accountId()).toBe(7);
  });

  it('selectAccount refuses when nobody is signed in', () => {
    const store = createStore();

    expect(store.selectAccount(7)).toBe(false);
    expect(store.accountId()).toBeNull();
  });

  it('signOut clears the session from both stores', () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const store = createStore({ session, local });

    store.signIn('token-1', 42, 'refresh-1');
    expect(store.isSignedIn()).toBe(true);

    store.signOut();

    expect(store.isSignedIn()).toBe(false);
    expect(store.accessToken()).toBeNull();
    expect(store.refreshToken()).toBeNull();
    expect(store.accountId()).toBeNull();
    expect(session.getItem(KEY)).toBeNull();
    expect(local.getItem(KEY)).toBeNull();
  });
});