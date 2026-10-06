import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { InstrumentCatalog } from '../../core/services/instrument-catalog.service';
import { WatchlistStore } from '../../core/watchlists/watchlist.store';
import { AlertChart } from '../../shared/alert-chart/alert-chart';
import { AlertList } from '../../shared/alert-list/alert-list';
import { SymbolPicker } from '../../shared/symbol-picker/symbol-picker';
import { WatchlistCard } from '../../shared/watchlist-card/watchlist-card';

/** How often the instrument prices behind the search boxes and "to go" figures are refreshed. */
export const CATALOG_REFRESH_MS = 60_000;

@Component({
  selector: 'tui-watchlists-page',
  imports: [WatchlistCard, AlertChart, AlertList, SymbolPicker],
  templateUrl: './watchlists-page.html'
})
export class WatchlistsPage {
  protected readonly store = inject(WatchlistStore);
  protected readonly catalog = inject(InstrumentCatalog);
  private readonly route = inject(ActivatedRoute, { optional: true });

  protected readonly newName = signal('');
  /** The stock whose chart is open for placing alerts: a one-item list, as the picker works in lists. */
  protected readonly alertPick = signal<string[]>([]);

  protected readonly alertSymbol = computed(() => this.alertPick()[0] ?? null);
  protected readonly alertInstrument = computed(() => this.catalog.find(this.alertSymbol()));
  protected readonly prices = computed(() =>
    Object.fromEntries(this.catalog.instruments().map((instrument) => [instrument.symbol, instrument.price]))
  );

  constructor() {
    this.store.start();
    this.catalog.ensureLoaded();
    const timer = setInterval(() => this.catalog.refresh(), CATALOG_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      this.store.stop();
    });

    // ?alert=TCS (from the bell beside a watchlist entry or the dashboard) opens that stock's chart.
    this.route?.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const wanted = params.get('alert')?.trim().toUpperCase();
      if (wanted) {
        this.alertPick.set([wanted]);
        setTimeout(() => document.querySelector('[data-testid="alerts-card"]')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
      }
    });

    // A stock that is no longer offered cannot stay selected.
    effect(() => {
      const symbol = this.alertSymbol();
      const known = this.catalog.ready();
      untracked(() => {
        if (symbol !== null && known && this.catalog.find(symbol) === null) {
          this.alertPick.set([]);
        }
      });
    });
  }

  protected setName(event: Event): void {
    this.newName.set((event.target as HTMLInputElement).value);
  }

  protected createWatchlist(): void {
    this.store.createWatchlist(this.newName()).subscribe((ok) => {
      if (ok) {
        this.newName.set('');
      }
    });
  }

  protected chooseAlertStock(symbols: string[]): void {
    this.alertPick.set(symbols);
  }
}
