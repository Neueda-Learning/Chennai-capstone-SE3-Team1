import { Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';

import { inferDirection, percentFrom, roundPrice } from '../../core/charts/price-axis';
import { formatMoney, formatSignedPercent } from '../../core/format/money';
import { PriceAlert } from '../../core/services/watchlist.service';
import { WatchlistStore } from '../../core/watchlists/watchlist.store';

export const QUICK_PERCENTS = [-5, -2, 2, 5] as const;

/**
 * Sets and manages price alerts for one stock, from a chart or by typing a price.
 *
 * With marker mode on, the chart's clicks set {@code pendingPrice}; this panel then confirms it. Which way the
 * alert waits is never asked for: a level above today's price waits for a rise to it, a level below waits for a
 * fall. The same panel lists the stock's existing alerts so they can be turned off, re-armed or removed.
 */
@Component({
  selector: 'tui-alert-composer',
  templateUrl: './alert-composer.html',
  styleUrl: './alert-composer.css'
})
export class AlertComposer {
  readonly symbol = input.required<string>();
  readonly currentPrice = input<number | null>(null);
  /** Whether chart clicks place markers. Two-way, so the chart and this panel stay in step. */
  readonly markerMode = model(false);
  /** The marker being placed (null when none). Two-way: the chart draws it, this panel confirms it. */
  readonly pendingPrice = model<number | null>(null);

  protected readonly store = inject(WatchlistStore);

  protected readonly formatMoney = formatMoney;
  protected readonly formatPercent = formatSignedPercent;
  protected readonly percents = QUICK_PERCENTS;

  protected readonly text = signal('');
  protected readonly saving = signal(false);
  protected readonly localError = signal<string | null>(null);
  protected readonly justSet = signal<string | null>(null);

  protected readonly alerts = computed(() => this.store.alertsFor(this.symbol()));
  protected readonly direction = computed(() => {
    const price = this.pendingPrice();
    return price === null ? 'ABOVE' : inferDirection(price, this.currentPrice());
  });
  protected readonly distance = computed(() => {
    const price = this.pendingPrice();
    return price === null ? null : percentFrom(price, this.currentPrice());
  });

  constructor() {
    // A marker from the chart (or a quick-percent button) fills the price box.
    effect(() => {
      const price = this.pendingPrice();
      untracked(() => {
        if (price !== null && Number(this.text()) !== price) {
          this.text.set(price.toFixed(2));
        }
        if (price === null) {
          this.text.set('');
        }
      });
    });
    // Moving to another stock drops a half-placed marker, which belonged to the last one.
    effect(() => {
      this.symbol();
      untracked(() => {
        this.pendingPrice.set(null);
        this.localError.set(null);
        this.justSet.set(null);
      });
    });
  }

  protected toggleMarkerMode(): void {
    this.markerMode.update((on) => !on);
    this.justSet.set(null);
    if (!this.markerMode()) {
      this.pendingPrice.set(null);
    }
  }

  /** For anyone not using the chart: start a marker at today's price and type the level wanted. */
  protected startByPrice(): void {
    const current = this.currentPrice();
    this.justSet.set(null);
    this.localError.set(null);
    if (current === null) {
      // No price to start from: open the form empty, and the box fills the marker as a price is typed.
      this.markerMode.set(true);
      return;
    }
    this.pendingPrice.set(roundPrice(current));
  }

  protected onType(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.text.set(value);
    this.localError.set(null);
    const price = Number(value);
    if (value.trim() !== '' && Number.isFinite(price) && price > 0) {
      this.pendingPrice.set(roundPrice(price));
    }
  }

  protected quick(percent: number): void {
    const current = this.currentPrice();
    if (current !== null) {
      this.pendingPrice.set(roundPrice(current * (1 + percent / 100)));
      this.localError.set(null);
    }
  }

  protected cancel(): void {
    this.pendingPrice.set(null);
    this.localError.set(null);
  }

  protected confirm(): void {
    const threshold = Number(this.text());
    if (this.text().trim() === '' || !Number.isFinite(threshold) || threshold <= 0) {
      this.localError.set('Enter a price greater than zero.');
      return;
    }
    const rounded = roundPrice(threshold);
    const direction = inferDirection(rounded, this.currentPrice());
    this.saving.set(true);
    this.store.createAlert({ symbol: this.symbol(), threshold: rounded, direction }).subscribe((ok) => {
      this.saving.set(false);
      if (ok) {
        this.localError.set(null);
        this.justSet.set(
          `You will be alerted when ${this.symbol()} ${direction === 'ABOVE' ? 'reaches' : 'falls to'} ${formatMoney(rounded)}.`
        );
        this.pendingPrice.set(null);
        this.markerMode.set(false);
      }
    });
  }

  protected toggleAlert(alert: PriceAlert): void {
    this.store.setAlertState(alert.id, alert.state === 'ARMED' ? 'DISABLED' : 'ARMED').subscribe();
  }

  protected removeAlert(alert: PriceAlert): void {
    this.store.deleteAlert(alert.id).subscribe();
  }

  protected arrow(alert: PriceAlert): string {
    return alert.direction === 'ABOVE' ? '▲ ≥' : '▼ ≤';
  }

  protected stateText(alert: PriceAlert): string {
    return { ARMED: 'Watching', FIRED: 'Triggered', DISABLED: 'Off' }[alert.state];
  }
}
