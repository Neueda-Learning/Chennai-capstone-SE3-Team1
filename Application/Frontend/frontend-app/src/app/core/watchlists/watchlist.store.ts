import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

import { SessionStore } from '../auth/session.store';
import { ErrorCatalog } from '../errors/error-catalog';
import {
  NewAlert,
  PriceAlert,
  Watchlist,
  WatchlistEntry,
  WatchlistService
} from '../services/watchlist.service';

export const REFRESH_MS = 30_000;

/** What happened to a batch of instruments added to a watchlist in one go. */
export interface AddOutcome {
  added: string[];
  failed: string[];
}

/**
 * The customer's watchlists and price alerts, held once for the whole app. The dashboard, the watchlists page and
 * the market page all read the same signals, so an alert placed on a chart shows up everywhere without each page
 * fetching and polling for itself.
 *
 * Pages call {@link start} when they appear and {@link stop} when they go; polling runs while at least one is open.
 */
@Injectable({ providedIn: 'root' })
export class WatchlistStore {
  private readonly api = inject(WatchlistService);
  private readonly session = inject(SessionStore);
  private readonly errors = inject(ErrorCatalog);

  readonly watchlists = signal<Watchlist[]>([]);
  readonly alerts = signal<PriceAlert[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly alertError = signal<string | null>(null);

  readonly armedAlerts = computed(() => this.alerts().filter((a) => a.state === 'ARMED'));
  /** Every symbol on any watchlist, for marking instruments that are already followed. */
  readonly watchedSymbols = computed(() => new Set(this.watchlists().flatMap((w) => w.instruments.map((i) => i.symbol))));

  private users = 0;
  private account: number | null | undefined = undefined;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // A different customer, or none, never sees the previous one's lists. The first run only records who is
    // signed in: nothing has been loaded yet, and a page that started the store has already asked for the data.
    effect(() => {
      const accountId = this.session.accountId();
      untracked(() => {
        const first = this.account === undefined;
        const changed = this.account !== accountId;
        this.account = accountId;
        if (first || !changed) {
          return;
        }
        this.reset();
        if (accountId !== null && this.users > 0) {
          this.refresh(true);
        }
      });
    });
  }

  start(): void {
    this.users++;
    if (this.users === 1) {
      this.refresh(true);
      this.timer = setInterval(() => this.refresh(false), REFRESH_MS);
    }
  }

  stop(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  alertsFor(symbol: string | null): PriceAlert[] {
    return symbol === null ? [] : this.alerts().filter((a) => a.symbol === symbol);
  }

  refresh(showErrors: boolean): void {
    const accountId = this.session.accountId();
    if (accountId === null) {
      this.loading.set(false);
      return;
    }
    if (!this.loaded()) {
      this.loading.set(true);
    }
    this.api.list(accountId).subscribe({
      next: (lists) => {
        this.watchlists.set(lists);
        this.error.set(null);
        this.loaded.set(true);
        this.loading.set(false);
      },
      error: (failure) => {
        if (showErrors) {
          this.error.set(this.errors.messageForTrade(failure));
        }
        this.loading.set(false);
      }
    });
    this.api.alerts(accountId).subscribe({
      next: (list) => this.alerts.set(list),
      error: (failure) => {
        if (showErrors) {
          this.alertError.set(this.errors.messageForTrade(failure));
        }
      }
    });
  }

  // ---- watchlists

  createWatchlist(name: string): Observable<boolean> {
    const accountId = this.session.accountId();
    const clean = name.trim();
    if (accountId === null || clean === '') {
      return of(false);
    }
    return this.api.create(accountId, clean).pipe(
      tap((created) => {
        this.error.set(null);
        this.watchlists.update((current) => [...current, created]);
      }),
      map(() => true),
      catchError((failure) => this.fail(this.error, failure))
    );
  }

  deleteWatchlist(watchlistId: string): Observable<boolean> {
    const accountId = this.session.accountId();
    if (accountId === null) {
      return of(false);
    }
    return this.api.remove(accountId, watchlistId).pipe(
      tap(() => {
        this.error.set(null);
        this.watchlists.update((current) => current.filter((w) => w.id !== watchlistId));
      }),
      map(() => true),
      catchError((failure) => this.fail(this.error, failure))
    );
  }

  /**
   * Adds several instruments at once (the service takes one at a time). Each is tried; the ones that went in are
   * shown straight away, and the outcome says which, if any, did not.
   */
  addInstruments(watchlistId: string, symbols: readonly string[]): Observable<AddOutcome> {
    const accountId = this.session.accountId();
    const wanted = [...new Set(symbols)];
    if (accountId === null || wanted.length === 0) {
      return of({ added: [], failed: [] });
    }
    return forkJoin(
      wanted.map((symbol) =>
        this.api.addInstrument(accountId, watchlistId, symbol).pipe(
          map((entry): { symbol: string; entry: WatchlistEntry | null; failure: unknown } => ({ symbol, entry, failure: null })),
          catchError((failure) => of({ symbol, entry: null as WatchlistEntry | null, failure }))
        )
      )
    ).pipe(
      map((results) => {
        const entries = results.filter((r) => r.entry !== null).map((r) => r.entry as WatchlistEntry);
        const failures = results.filter((r) => r.entry === null);
        this.watchlists.update((current) =>
          current.map((w) =>
            w.id !== watchlistId
              ? w
              : { ...w, instruments: [...w.instruments, ...entries.filter((e) => !w.instruments.some((i) => i.symbol === e.symbol))] }
          )
        );
        this.error.set(failures.length === 0 ? null : this.errors.messageForTrade(failures[0].failure));
        return { added: entries.map((e) => e.symbol), failed: failures.map((f) => f.symbol) };
      })
    );
  }

  removeInstrument(watchlistId: string, symbol: string): Observable<boolean> {
    const accountId = this.session.accountId();
    if (accountId === null) {
      return of(false);
    }
    return this.api.removeInstrument(accountId, watchlistId, symbol).pipe(
      tap(() => {
        this.error.set(null);
        this.watchlists.update((current) =>
          current.map((w) => (w.id === watchlistId ? { ...w, instruments: w.instruments.filter((i) => i.symbol !== symbol) } : w))
        );
      }),
      map(() => true),
      catchError((failure) => this.fail(this.error, failure))
    );
  }

  // ---- alerts

  createAlert(alert: NewAlert): Observable<boolean> {
    const accountId = this.session.accountId();
    if (accountId === null) {
      return of(false);
    }
    return this.api.createAlert(accountId, alert).pipe(
      tap((created) => {
        this.alertError.set(null);
        this.alerts.update((current) => [created, ...current]);
      }),
      map(() => true),
      catchError((failure) => this.fail(this.alertError, failure))
    );
  }

  setAlertState(alertId: string, state: 'ARMED' | 'DISABLED'): Observable<boolean> {
    const accountId = this.session.accountId();
    if (accountId === null) {
      return of(false);
    }
    return this.api.setAlertState(accountId, alertId, state).pipe(
      tap((updated) => {
        this.alertError.set(null);
        this.alerts.update((current) => current.map((a) => (a.id === updated.id ? updated : a)));
      }),
      map(() => true),
      catchError((failure) => this.fail(this.alertError, failure))
    );
  }

  deleteAlert(alertId: string): Observable<boolean> {
    const accountId = this.session.accountId();
    if (accountId === null) {
      return of(false);
    }
    return this.api.removeAlert(accountId, alertId).pipe(
      tap(() => {
        this.alertError.set(null);
        this.alerts.update((current) => current.filter((a) => a.id !== alertId));
      }),
      map(() => true),
      catchError((failure) => this.fail(this.alertError, failure))
    );
  }

  private fail(target: { set(value: string | null): void }, failure: unknown): Observable<boolean> {
    target.set(this.errors.messageForTrade(failure));
    return of(false);
  }

  private reset(): void {
    this.watchlists.set([]);
    this.alerts.set([]);
    this.loaded.set(false);
    this.loading.set(false);
    this.error.set(null);
    this.alertError.set(null);
  }
}
