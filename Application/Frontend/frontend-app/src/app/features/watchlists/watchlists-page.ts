import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';

import { SessionStore } from '../../core/auth/session.store';
import { ErrorCatalog } from '../../core/errors/error-catalog';
import { formatMoney, formatSignedPercent } from '../../core/format/money';
import {
  AlertDeliveryState,
  AlertDirection,
  PriceAlert,
  Watchlist,
  WatchlistService
} from '../../core/services/watchlist.service';

export const REFRESH_MS = 30_000;

const DELIVERY_TEXT: Record<AlertDeliveryState, string> = {
  QUEUED: 'Sent to your notifications',
  PENDING_CHANNEL: 'Waiting for you to choose a channel in Settings',
  REJECTED: 'Notifications refused it',
  DELIVERY_FAILED: 'Could not be handed to notifications'
};

@Component({
  selector: 'tui-watchlists-page',
  imports: [DatePipe],
  templateUrl: './watchlists-page.html'
})
export class WatchlistsPage {
  private readonly api = inject(WatchlistService);
  private readonly session = inject(SessionStore);
  private readonly errors = inject(ErrorCatalog);

  protected readonly formatMoney = formatMoney;
  protected readonly formatPercent = formatSignedPercent;

  protected readonly loading = signal(true);
  protected readonly watchlists = signal<Watchlist[]>([]);
  protected readonly alerts = signal<PriceAlert[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly alertError = signal<string | null>(null);
  protected readonly newName = signal('');
  protected readonly alertSymbol = signal('');
  protected readonly alertThreshold = signal('');
  protected readonly alertDirection = signal<AlertDirection>('ABOVE');
  protected readonly symbolDrafts = signal<Record<string, string>>({});

  constructor() {
    this.refresh(true);
    const timer = setInterval(() => this.refresh(false), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected setName(event: Event): void {
    this.newName.set((event.target as HTMLInputElement).value);
  }

  protected setAlertSymbol(event: Event): void {
    this.alertSymbol.set((event.target as HTMLInputElement).value);
  }

  protected setAlertThreshold(event: Event): void {
    this.alertThreshold.set((event.target as HTMLInputElement).value);
  }

  protected setAlertDirection(event: Event): void {
    this.alertDirection.set((event.target as HTMLSelectElement).value as AlertDirection);
  }

  protected setSymbolDraft(watchlistId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.symbolDrafts.update((drafts) => ({ ...drafts, [watchlistId]: value }));
  }

  protected symbolDraft(watchlistId: string): string {
    return this.symbolDrafts()[watchlistId] ?? '';
  }

  protected createWatchlist(): void {
    const accountId = this.session.accountId();
    const name = this.newName().trim();
    if (accountId === null || name === '') {
      return;
    }
    this.api.create(accountId, name).subscribe({
      next: (created) => {
        this.error.set(null);
        this.newName.set('');
        this.watchlists.update((current) => [...current, created]);
      },
      error: (failure) => this.error.set(this.errors.messageForTrade(failure))
    });
  }

  protected deleteWatchlist(watchlist: Watchlist): void {
    const accountId = this.session.accountId();
    if (accountId === null) {
      return;
    }
    this.api.remove(accountId, watchlist.id).subscribe({
      next: () => {
        this.error.set(null);
        this.watchlists.update((current) => current.filter((w) => w.id !== watchlist.id));
      },
      error: (failure) => this.error.set(this.errors.messageForTrade(failure))
    });
  }

  protected addInstrument(watchlist: Watchlist): void {
    const accountId = this.session.accountId();
    const symbol = this.symbolDraft(watchlist.id).trim();
    if (accountId === null || symbol === '') {
      return;
    }
    this.api.addInstrument(accountId, watchlist.id, symbol).subscribe({
      next: (entry) => {
        this.error.set(null);
        this.symbolDrafts.update((drafts) => ({ ...drafts, [watchlist.id]: '' }));
        this.watchlists.update((current) =>
          current.map((w) =>
            w.id !== watchlist.id || w.instruments.some((i) => i.symbol === entry.symbol)
              ? w
              : { ...w, instruments: [...w.instruments, entry] }
          )
        );
      },
      error: (failure) => this.error.set(this.errors.messageForTrade(failure))
    });
  }

  protected removeInstrument(watchlist: Watchlist, symbol: string): void {
    const accountId = this.session.accountId();
    if (accountId === null) {
      return;
    }
    this.api.removeInstrument(accountId, watchlist.id, symbol).subscribe({
      next: () => {
        this.error.set(null);
        this.watchlists.update((current) =>
          current.map((w) =>
            w.id === watchlist.id ? { ...w, instruments: w.instruments.filter((i) => i.symbol !== symbol) } : w
          )
        );
      },
      error: (failure) => this.error.set(this.errors.messageForTrade(failure))
    });
  }

  protected createAlert(): void {
    const accountId = this.session.accountId();
    const symbol = this.alertSymbol().trim();
    const threshold = Number(this.alertThreshold());
    if (accountId === null || symbol === '') {
      return;
    }
    if (this.alertThreshold().trim() === '' || !Number.isFinite(threshold) || threshold <= 0) {
      this.alertError.set('Enter a threshold greater than zero.');
      return;
    }
    this.api.createAlert(accountId, { symbol, threshold, direction: this.alertDirection() }).subscribe({
      next: (created) => {
        this.alertError.set(null);
        this.alertSymbol.set('');
        this.alertThreshold.set('');
        this.alerts.update((current) => [created, ...current]);
      },
      error: (failure) => this.alertError.set(this.errors.messageForTrade(failure))
    });
  }

  protected setAlertState(alert: PriceAlert, state: 'ARMED' | 'DISABLED'): void {
    const accountId = this.session.accountId();
    if (accountId === null) {
      return;
    }
    this.api.setAlertState(accountId, alert.id, state).subscribe({
      next: (updated) => {
        this.alertError.set(null);
        this.alerts.update((current) => current.map((a) => (a.id === updated.id ? updated : a)));
      },
      error: (failure) => this.alertError.set(this.errors.messageForTrade(failure))
    });
  }

  protected deleteAlert(alert: PriceAlert): void {
    const accountId = this.session.accountId();
    if (accountId === null) {
      return;
    }
    this.api.removeAlert(accountId, alert.id).subscribe({
      next: () => {
        this.alertError.set(null);
        this.alerts.update((current) => current.filter((a) => a.id !== alert.id));
      },
      error: (failure) => this.alertError.set(this.errors.messageForTrade(failure))
    });
  }

  protected directionText(direction: AlertDirection): string {
    return direction === 'ABOVE' ? 'rises to or above' : 'falls to or below';
  }

  protected stateText(alert: PriceAlert): string {
    return { ARMED: 'Watching', FIRED: 'Triggered', DISABLED: 'Off' }[alert.state];
  }

  protected deliveryText(alert: PriceAlert): string | null {
    if (alert.state !== 'FIRED') {
      return null;
    }
    return alert.deliveryState === null ? 'Handing over to notifications' : DELIVERY_TEXT[alert.deliveryState];
  }

  private refresh(showLoading: boolean): void {
    const accountId = this.session.accountId();
    if (accountId === null) {
      this.loading.set(false);
      return;
    }
    this.api.list(accountId).subscribe({
      next: (lists) => {
        this.watchlists.set(lists);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (failure) => {
        if (showLoading) {
          this.error.set(this.errors.messageForTrade(failure));
        }
        this.loading.set(false);
      }
    });
    this.api.alerts(accountId).subscribe({
      next: (list) => this.alerts.set(list),
      error: (failure) => {
        if (showLoading) {
          this.alertError.set(this.errors.messageForTrade(failure));
        }
      }
    });
  }
}
