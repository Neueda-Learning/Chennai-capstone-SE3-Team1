import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';

import { Candle, MarketService } from '../../core/services/market.service';
import { WatchlistStore } from '../../core/watchlists/watchlist.store';
import { PriceChart } from '../../features/orders/price-chart';
import { AlertComposer } from '../alert-composer/alert-composer';

interface Preset {
  label: string;
  range: string;
  interval: string;
}

/** A few simple spans for a chart whose job is picking a price level, not studying the stock. */
export const ALERT_CHART_PRESETS: readonly Preset[] = [
  { label: '1D', range: '1d', interval: '5m' },
  { label: '1W', range: '1w', interval: '30m' },
  { label: '1M', range: '1mo', interval: '1d' },
  { label: '3M', range: '3mo', interval: '1d' },
  { label: '1Y', range: '1y', interval: '1d' }
];

type Load = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * A stock's price chart with its alerts drawn on it, and the panel to place more: click the chart where you want
 * the alert, confirm, done. Used wherever a customer manages alerts away from the full market page.
 */
@Component({
  selector: 'tui-alert-chart',
  imports: [PriceChart, AlertComposer],
  templateUrl: './alert-chart.html',
  styleUrl: './alert-chart.css'
})
export class AlertChart {
  readonly symbol = input.required<string>();
  readonly name = input('');
  readonly currentPrice = input<number | null>(null);

  private readonly market = inject(MarketService);
  protected readonly store = inject(WatchlistStore);

  protected readonly presets = ALERT_CHART_PRESETS;
  protected readonly preset = signal<Preset>(ALERT_CHART_PRESETS[2]);
  protected readonly candles = signal<Candle[]>([]);
  protected readonly state = signal<Load>('idle');
  protected readonly markerMode = signal(false);
  protected readonly pending = signal<number | null>(null);
  protected readonly alerts = computed(() => this.store.alertsFor(this.symbol()));

  private request: Subscription | null = null;

  constructor() {
    effect(() => {
      const symbol = this.symbol();
      const preset = this.preset();
      untracked(() => this.load(symbol, preset));
    });
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  protected select(preset: Preset): void {
    this.preset.set(preset);
  }

  protected place(price: number): void {
    this.pending.set(price);
  }

  private load(symbol: string, preset: Preset): void {
    this.request?.unsubscribe();
    this.state.set('loading');
    this.request = this.market.getCandles(symbol, preset.interval, preset.range).subscribe({
      next: (candles) => {
        this.candles.set(candles);
        this.state.set('ready');
      },
      error: () => {
        this.candles.set([]);
        this.state.set('failed');
      }
    });
  }
}
