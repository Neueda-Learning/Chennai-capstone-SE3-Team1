import { Injectable, computed, inject, signal } from '@angular/core';

import { MarketQuote, MarketService } from './market.service';

export interface Instrument {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Every instrument that can be traded, taken from the market quotes. The search boxes read their options from
 * here, so a customer picks from a list instead of having to know and type a symbol.
 */
@Injectable({ providedIn: 'root' })
export class InstrumentCatalog {
  private readonly market = inject(MarketService);

  readonly instruments = signal<Instrument[]>([]);
  readonly state = signal<LoadState>('idle');
  readonly ready = computed(() => this.state() === 'ready');

  /** Loads once; later calls do nothing unless the first attempt failed. */
  ensureLoaded(): void {
    if (this.state() === 'loading' || this.state() === 'ready') {
      return;
    }
    this.refresh();
  }

  refresh(): void {
    if (this.state() !== 'ready') {
      this.state.set('loading');
    }
    this.market.getQuotes().subscribe({
      next: (quotes) => {
        this.instruments.set(quotes.map(toInstrument).sort((a, b) => a.symbol.localeCompare(b.symbol)));
        this.state.set('ready');
      },
      error: () => {
        // Keep whatever list we already had; the picker stays usable on stale data.
        this.state.set(this.instruments().length > 0 ? 'ready' : 'failed');
      }
    });
  }

  find(symbol: string | null): Instrument | null {
    return symbol === null ? null : (this.instruments().find((i) => i.symbol === symbol) ?? null);
  }
}

function toInstrument(quote: MarketQuote): Instrument {
  return { symbol: quote.symbol, name: quote.name, price: quote.price, changePercent: quote.changePercent };
}
