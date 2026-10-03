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
    store.signIn('token-1', 42, 'refresh-1', false);
    expect(store.isSignedIn()).toBe(true);
    expect(store.accessToken()).toBe('token-1');
    expect(store.refreshToken()).toBe('refresh-1');
    expect(store.accountId()).toBe(42);
  });

  it('reads accountId from the JWT claim when it is not handed over', () => {
    const store = createStore();
    store.signIn(jwt({ accountId: 7 }), null, null, false);
    expect(store.isSignedIn()).toBe(true);
    expect(store.accountId()).toBe(7);
  });

  it('treats a token without an accountId claim as having none', () => {
    const store = createStore();
    store.signIn(jwt({ sub: '8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f' }), null, null, false);
    expect(store.isSignedIn()).toBe(true);
    expect(store.accountId()).toBeNull();
  });

  it('lets an explicit accountId win over the JWT claim', () => {
    const store = createStore();
    store.signIn(jwt({ accountId: 1 }), 42, null, false);
    expect(store.accountId()).toBe(42);
  });

  it('tolerates a token that is not a JWT at all', () => {
    const store = createStore();
    expect(() => store.signIn('token', null, null, false)).not.toThrow();
    expect(store.isSignedIn()).toBe(true);
    expect(store.accountId()).toBeNull();
  });

  it('keeps a remembered session in localStorage and out of sessionStorage', () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const store = createStore({ session, local });

    store.signIn('token-1', 42, 'refresh-1', true);

    expect(store.isSignedIn()).toBe(true);
    expect(local.getItem(KEY)).toContain('token-1');
    expect(session.getItem(KEY)).toBeNull();
  });

  it('keeps a tab-lifecycle session in sessionStorage and out of localStorage', () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const store = createStore({ session, local });

    store.signIn('token-1', 42, 'refresh-1', false);

    expect(session.getItem(KEY)).toContain('token-1');
    expect(local.getItem(KEY)).toBeNull();
  });

  it('a new sign-in replaces the previous one everywhere', () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const store = createStore({ session, local });

    store.signIn('token-one', 1, null, true);
    store.signIn('token-two', 2, null, false);

    expect(store.accessToken()).toBe('token-two');
    expect(local.getItem(KEY)).toBeNull();
    expect(session.getItem(KEY)).toContain('token-two');
  });

  it('reads the accountId from a token whose payload encodes to base64url with an underscore', () => {
    // {"accountId":42,"n":"???"} is standard base64 with a "/" in it, which base64url writes as "_".
    const token = jwt({ accountId: 42, n: '???' });
    expect(token.split('.')[1]).toContain('_');

    const store = createStore();
    store.signIn(token);

    expect(store.accountId()).toBe(42);
  });

  it('restores only the remembered session on a future boot', () => {
    const local = new MemoryStorage();
    local.setItem(
      KEY,
      JSON.stringify({
        accessToken: 'token-persisted',
        refreshToken: 'refresh-persisted',
        accountId: 5,
        remembered: true
      })
    );

    const store = createStore({ local });

    expect(store.isSignedIn()).toBe(true);
    expect(store.accessToken()).toBe('token-persisted');
    expect(store.refreshToken()).toBe('refresh-persisted');
    expect(store.accountId()).toBe(5);
  });

  it('keeps a tab-only session across a reload of that tab', () => {
    const session = new MemoryStorage();
    session.setItem(
      KEY,
      JSON.stringify({ accessToken: 'tab-token', refreshToken: 'tab-refresh', accountId: 3, remembered: false })
    );

    const store = createStore({ session });

    expect(store.isSignedIn()).toBe(true);
    expect(store.accessToken()).toBe('tab-token');
    expect(store.refreshToken()).toBe('tab-refresh');
    expect(store.accountId()).toBe(3);
  });

  it('prefers the remembered session when both stores hold one', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem(KEY, JSON.stringify({ accessToken: 'remembered', refreshToken: null, accountId: 1, remembered: true }));
    session.setItem(KEY, JSON.stringify({ accessToken: 'tab', refreshToken: null, accountId: 2, remembered: false }));

    expect(createStore({ local, session }).accessToken()).toBe('remembered');
  });

  it('falls back to the tab session when the remembered one is unreadable', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem(KEY, 'not-json');
    session.setItem(KEY, JSON.stringify({ accessToken: 'tab', refreshToken: null, accountId: 2, remembered: false }));

    expect(createStore({ local, session }).accessToken()).toBe('tab');
  });

  it('a tab-only session reloaded still re-persists as tab-only, never promoted to remembered', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    session.setItem(KEY, JSON.stringify({ accessToken: 'tab', refreshToken: 'r', accountId: 2, remembered: false }));

    const store = createStore({ local, session });
    store.adoptTokens('tab-2', 2, 'r2'); // re-persists using whichever store held the session

    expect(local.getItem(KEY)).toBeNull();
    expect(JSON.parse(session.getItem(KEY)!).accessToken).toBe('tab-2');
  });

  it('ignores a tab session with no token', () => {
    const session = new MemoryStorage();
    session.setItem(KEY, JSON.stringify({ accessToken: '', refreshToken: null, accountId: 3 }));

    expect(createStore({ session }).isSignedIn()).toBe(false);
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

    expect(() => store.signIn('token-1', 42, 'refresh-1', true)).not.toThrow();
    expect(store.isSignedIn()).toBe(true);
    expect(store.accountId()).toBe(42);

    expect(() => store.signOut()).not.toThrow();
    expect(store.isSignedIn()).toBe(false);
    expect(store.accountId()).toBeNull();
  });

  it('signOut clears the session and both stores', () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const store = createStore({ session, local });

    store.signIn('token-1', 42, 'refresh-1', false);
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