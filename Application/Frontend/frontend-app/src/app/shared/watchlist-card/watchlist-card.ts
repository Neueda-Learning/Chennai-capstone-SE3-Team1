import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { formatMoney, formatSignedPercent } from '../../core/format/money';
import { InstrumentCatalog } from '../../core/services/instrument-catalog.service';
import { Watchlist } from '../../core/services/watchlist.service';
import { WatchlistStore } from '../../core/watchlists/watchlist.store';
import { SymbolPicker } from '../symbol-picker/symbol-picker';

/**
 * One watchlist: what is on it with live prices, and a search box to add more. The box is a multi-select, so a
 * handful of instruments go in with one press of Add instead of typing each symbol and adding it in turn.
 */
@Component({
  selector: 'tui-watchlist-card',
  imports: [SymbolPicker, RouterLink],
  templateUrl: './watchlist-card.html',
  styleUrl: './watchlist-card.css'
})
export class WatchlistCard {
  readonly watchlist = input.required<Watchlist>();
  /** Shows the watchlist's name and a Delete button. Off where the name is already shown elsewhere (a tab). */
  readonly showHeader = input(true);
  readonly compact = input(false);

  protected readonly store = inject(WatchlistStore);
  protected readonly catalog = inject(InstrumentCatalog);

  protected readonly formatMoney = formatMoney;
  protected readonly formatPercent = formatSignedPercent;

  protected readonly picked = signal<string[]>([]);
  protected readonly adding = signal(false);
  protected readonly note = signal<string | null>(null);

  protected readonly present = computed(() => this.watchlist().instruments.map((i) => i.symbol));

  constructor() {
    this.catalog.ensureLoaded();
  }

  protected pick(symbols: string[]): void {
    this.picked.set(symbols);
    this.note.set(null);
  }

  protected add(): void {
    const symbols = this.picked();
    if (symbols.length === 0 || this.adding()) {
      return;
    }
    this.adding.set(true);
    this.store.addInstruments(this.watchlist().id, symbols).subscribe((outcome) => {
      this.adding.set(false);
      this.picked.set(outcome.failed); // anything refused stays chosen, so it can be seen and retried or dropped
      this.note.set(
        outcome.added.length === 0
          ? null
          : `Added ${outcome.added.length === 1 ? outcome.added[0] : `${outcome.added.length} instruments`} to ${this.watchlist().name}.`
      );
    });
  }

  protected remove(symbol: string): void {
    this.note.set(null);
    this.store.removeInstrument(this.watchlist().id, symbol).subscribe();
  }

  protected delete(): void {
    this.store.deleteWatchlist(this.watchlist().id).subscribe();
  }
}
