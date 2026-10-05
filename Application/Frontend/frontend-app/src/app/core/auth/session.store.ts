import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';

export const LOCAL_STORAGE = new InjectionToken<Storage>(
  'Storage for sessions',
  { factory: () => localStorage }
);

export const SESSION_STORAGE = new InjectionToken<Storage>(
  'Legacy tab-lifecycle storage: migrated into LOCAL_STORAGE on boot, then cleared',
  { factory: () => sessionStorage }
);

interface PersistedSession {
  accessToken: string;
  refreshToken: string | null;
  accountId: number | null;
}

const SESSION_KEY = 'trading-ui.session';

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
      this.persist();
    }
    this.clearLegacyStore();
  }

  readonly isSignedIn = computed(() => this.token() !== null);

  readonly accountId = computed(() => this.account());

  readonly accessToken = computed(() => this.token());

  readonly refreshToken = computed(() => this.refresh());

  signIn(accessToken: string, accountId: number | null = null, refreshToken: string | null = null): void {
    this.token.set(accessToken);
    this.refresh.set(refreshToken);
    this.account.set(accountId ?? decodeAccountId(accessToken));
    this.persist();
  }

  signOut(): void {
    this.token.set(null);
    this.refresh.set(null);
    this.account.set(null);
    this.clearSession();
  }

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

  private clearSession(): void {
    for (const store of [this.store, this.legacyStore]) {
      try {
        store.removeItem(SESSION_KEY);
      } catch {
      }
    }
  }

  private clearLegacyStore(): void {
    try {
      this.legacyStore.removeItem(SESSION_KEY);
    } catch {
    }
  }
}

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