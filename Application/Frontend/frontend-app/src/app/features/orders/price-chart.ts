import { Component, ElementRef, OnDestroy, afterRenderEffect, computed, inject, input, output, signal, viewChild } from '@angular/core';
import ApexCharts from 'apexcharts';
import type { ApexAxisChartSeries, ApexOptions } from 'apexcharts';

type YAxisAnnotations = NonNullable<NonNullable<ApexOptions['annotations']>['yaxis']>[number];

import { chartPalette } from '../../core/charts/chart-theme';
import { IndicatorId } from '../../core/charts/chart-options';
import { bollinger, ema, macd, rsi, sma } from '../../core/charts/indicators';
import { PlotGeometry, insidePlot, isFiniteGeometry, priceAtOffset } from '../../core/charts/price-axis';
import { formatMoney } from '../../core/format/money';
import { Candle } from '../../core/services/market.service';
import { PriceAlert } from '../../core/services/watchlist.service';
import { ThemeService } from '../../core/theme/theme.service';

const FONT = 'Plus Jakarta Sans, sans-serif';

const COLORS = {
  sma20: '#F59E0B',
  sma50: '#3B82F6',
  ema20: '#A855F7',
  bollinger: '#94A3B8',
  macd: '#3B82F6',
  signal: '#F97316',
  rsi: '#A855F7'
};

type Pane = 'main' | 'volume' | 'rsi' | 'macd';

const ALERT_COLORS = { quiet: '#94A3B8', pending: '#3B82F6' };

/** The moving-average lines a scheduled order is drawn against: the slowest is the line, a faster one is optional. */
const AVERAGE_COLORS = ['#10B981', '#EC4899'];

/** A scheduled (conditional) order waiting at a price level, drawn as a line on the chart. */
export interface OrderLevel {
  price: number;
  side: 'BUY' | 'SELL';
  label: string;
}

/** The marker the customer is placing, drawn on the chart before it becomes an alert. */
export interface GuideLine {
  top: number;
  left: number;
  width: number;
  price: number;
}

@Component({
  selector: 'tui-price-chart',
  templateUrl: './price-chart.html',
  styleUrl: './price-chart.css'
})
export class PriceChart implements OnDestroy {
  readonly candles = input.required<readonly Candle[]>();
  readonly style = input<'candles' | 'line'>('candles');
  readonly indicators = input<readonly IndicatorId[]>([]);
  readonly hasVolume = input(false);
  /** The alerts for the stock on show: each is drawn as a labelled line at its threshold. */
  readonly alerts = input<readonly PriceAlert[]>([]);
  /** When on, a guide line follows the pointer and a click places an alert marker at that price. */
  readonly markerMode = input(false);
  /** The marker being placed, drawn until it is confirmed or cancelled. */
  readonly pendingPrice = input<number | null>(null);
  /** The pending marker's label: a new alert, or the level of a new scheduled order. */
  readonly pendingLabel = input('New alert');
  /** Simple moving averages to draw, by window in candles: the scheduled-order panel's average lines. */
  readonly averages = input<readonly number[]>([]);
  /** Scheduled orders waiting at a price level for the stock on show. */
  readonly orderLevels = input<readonly OrderLevel[]>([]);
  readonly markerPlaced = output<number>();

  protected readonly guide = signal<GuideLine | null>(null);
  protected readonly formatMoney = formatMoney;

  private readonly theme = inject(ThemeService);

  private readonly mainEl = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly volumeEl = viewChild.required<ElementRef<HTMLElement>>('volume');
  private readonly rsiEl = viewChild.required<ElementRef<HTMLElement>>('rsi');
  private readonly macdEl = viewChild.required<ElementRef<HTMLElement>>('macd');

  private readonly charts = new Map<Pane, ApexCharts>();

  protected readonly show = computed(() => {
    const on = new Set(this.indicators());
    return {
      volume: on.has('volume') && this.hasVolume(),
      rsi: on.has('rsi'),
      macd: on.has('macd')
    };
  });

  constructor() {
    afterRenderEffect(() => {
      const candles = this.candles();
      const palette = chartPalette(this.theme.isDark());
      const show = this.show();
      const indicators = new Set(this.indicators());
      this.style();
      this.alerts();
      this.pendingPrice();
      this.pendingLabel();
      this.averages();
      this.orderLevels();
      this.markerMode();

      this.sync('main', this.mainEl().nativeElement, true, () => this.mainOptions(candles, indicators, palette));
      this.sync('volume', this.volumeEl().nativeElement, show.volume, () => this.volumeOptions(candles, palette));
      this.sync('rsi', this.rsiEl().nativeElement, show.rsi, () => this.rsiOptions(candles, palette));
      this.sync('macd', this.macdEl().nativeElement, show.macd, () => this.macdOptions(candles, palette));
    });
  }

  protected onMove(event: MouseEvent): void {
    if (!this.markerMode()) {
      this.guide.set(null);
      return;
    }
    const at = this.pointer(event);
    const geometry = this.geometry();
    if (at === null || geometry === null || !insidePlot(geometry, at.x, at.y)) {
      this.guide.set(null);
      return;
    }
    const price = priceAtOffset(geometry, at.y);
    this.guide.set(price === null ? null : { top: at.y, left: geometry.translateX, width: geometry.gridWidth, price });
  }

  protected onClick(event: MouseEvent): void {
    if (!this.markerMode()) {
      return;
    }
    const at = this.pointer(event);
    const geometry = this.geometry();
    if (at === null || geometry === null || !insidePlot(geometry, at.x, at.y)) {
      return;
    }
    const price = priceAtOffset(geometry, at.y);
    if (price !== null && price > 0) {
      this.markerPlaced.emit(price);
    }
  }

  /** Pixels from the chart's top-left corner. */
  private pointer(event: MouseEvent): { x: number; y: number } | null {
    const rect = this.mainEl().nativeElement.getBoundingClientRect();
    return Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : null;
  }

  /** The plotting area and price range of the main pane, as ApexCharts has laid them out. */
  protected geometry(): PlotGeometry | null {
    const globals = (this.charts.get('main') as unknown as { w?: { globals?: Record<string, unknown> } } | undefined)?.w?.globals;
    if (!globals) {
      return null;
    }
    const range = (key: string): number => (globals[key] as number[] | undefined)?.[0] ?? Number.NaN;
    const geometry: PlotGeometry = {
      translateX: globals['translateX'] as number,
      translateY: globals['translateY'] as number,
      gridWidth: globals['gridWidth'] as number,
      gridHeight: globals['gridHeight'] as number,
      min: range('minYArr'),
      max: range('maxYArr')
    };
    return isFiniteGeometry(geometry) ? geometry : null;
  }

  ngOnDestroy(): void {
    this.charts.forEach((chart) => chart.destroy());
    this.charts.clear();
  }

  private sync(pane: Pane, element: HTMLElement, wanted: boolean, options: () => ApexOptions): void {
    const existing = this.charts.get(pane);
    if (!wanted) {
      existing?.destroy();
      this.charts.delete(pane);
      return;
    }
    if (existing) {
      if (pane === 'main') {
        existing.clearAnnotations(); // otherwise a removed alert's line would linger
      }
      existing.updateOptions(options(), false, false).catch((error: unknown) => console.error(`[chart] could not update the ${pane} pane`, error));
      return;
    }
    const chart = new ApexCharts(element, options());
    this.charts.set(pane, chart);
    chart.render().catch((error: unknown) => console.error(`[chart] could not draw the ${pane} pane`, error));
  }

  private base(id: string, height: number, palette: ReturnType<typeof chartPalette>): ApexOptions {
    return {
      chart: {
        id,
        type: 'line',
        height,
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: false },
        fontFamily: FONT,
        foreColor: palette.fore,
        background: 'transparent'
      },
      dataLabels: { enabled: false },
      fill: { opacity: 1 },
      grid: { borderColor: palette.grid, strokeDashArray: 4 },
      legend: { show: false },
      noData: { text: 'No data for this range yet', style: { color: palette.fore } },
      xaxis: {
        type: 'datetime',
        labels: { datetimeUTC: false, style: { colors: palette.fore, fontSize: '11px' } },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      tooltip: { theme: palette.tooltip, shared: true, intersect: false, x: { format: 'dd MMM yyyy, HH:mm' } }
    };
  }

  private mainOptions(candles: readonly Candle[], on: Set<IndicatorId>, palette: ReturnType<typeof chartPalette>): ApexOptions {
    const times = candles.map((c) => Date.parse(c.time));
    const closes = candles.map((c) => c.close);
    const series: ApexAxisChartSeries = [];
    const colors: string[] = [];
    const widths: number[] = [];

    if (this.style() === 'candles') {
      series.push({
        name: 'Price',
        type: 'candlestick',
        data: candles.map((c, i) => ({ x: times[i], y: [c.open, c.high, c.low, c.close] }))
      });
      colors.push(palette.primary);
      widths.push(1);
    } else {
      const falling = closes.length > 1 && closes[closes.length - 1] < closes[0];
      series.push({ name: 'Close', type: 'area', data: candles.map((c, i) => ({ x: times[i], y: c.close })) });
      colors.push(falling ? palette.down : palette.up);
      widths.push(2);
    }

    const line = (name: string, values: (number | null)[], color: string, width = 1.5) => {
      series.push({ name, type: 'line', data: values.map((v, i) => ({ x: times[i], y: v })) });
      colors.push(color);
      widths.push(width);
    };
    if (on.has('sma20')) line('SMA 20', sma(closes, 20), COLORS.sma20);
    if (on.has('sma50')) line('SMA 50', sma(closes, 50), COLORS.sma50);
    if (on.has('ema20')) line('EMA 20', ema(closes, 20), COLORS.ema20);
    if (on.has('bollinger')) {
      const b = bollinger(closes, 20, 2);
      line('BB upper', b.upper, COLORS.bollinger, 1);
      line('BB middle', b.middle, COLORS.bollinger, 1);
      line('BB lower', b.lower, COLORS.bollinger, 1);
    }
    [...this.averages()].sort((a, b) => b - a).forEach((window, i) =>
      line(`Avg ${window}`, sma(closes, window), AVERAGE_COLORS[i % AVERAGE_COLORS.length], i === 0 ? 2.5 : 2)
    );

    const drawn: number[] = candles.flatMap((c) => [c.low, c.high]);
    const levels = this.alerts().filter((a) => a.state !== 'DISABLED').map((a) => a.threshold);
    levels.push(...this.orderLevels().map((o) => o.price));
    const pending = this.pendingPrice();
    if (pending !== null) {
      levels.push(pending);
    }
    drawn.push(...levels);
    series.slice(1).forEach((s) => (s.data as unknown[]).forEach((d) => {
      const v = (d as { y?: unknown }).y;
      if (typeof v === 'number') {
        drawn.push(v);
      }
    }));
    const lo = drawn.length ? Math.min(...drawn) : undefined;
    const hi = drawn.length ? Math.max(...drawn) : undefined;
    const pad = lo !== undefined && hi !== undefined ? Math.max((hi - lo) * 0.04, hi * 0.0005) : 0;

    const options = this.base('price-main', 340, palette);
    return {
      ...options,
      series,
      colors,
      stroke: { curve: 'straight', width: widths },
      fill: { type: 'solid', opacity: [0.18, ...widths.slice(1).map(() => 1)] },
      plotOptions: { candlestick: { colors: { upward: palette.up, downward: palette.down }, wick: { useFillColor: true } } },
      annotations: { yaxis: this.alertLines(palette) },
      yaxis: {
        min: lo === undefined ? undefined : lo - pad,
        max: hi === undefined ? undefined : hi + pad,
        forceNiceScale: false,
        decimalsInFloat: 2,
        labels: { minWidth: 64, formatter: (v: number) => formatMoney(v), style: { colors: palette.fore, fontSize: '11px' } }
      },
      // While a marker is being placed the guide line is the readout; the hover tooltip would only sit on top of it.
      tooltip: { ...options.tooltip, enabled: !this.markerMode(), y: { formatter: (v: number) => (v === undefined || v === null ? '' : formatMoney(v)) } }
    };
  }

  private alertLines(palette: ReturnType<typeof chartPalette>): YAxisAnnotations[] {
    const lines: YAxisAnnotations[] = this.alerts().map((alert) => {
      const armed = alert.state === 'ARMED';
      const color = armed ? (alert.direction === 'ABOVE' ? palette.up : palette.down) : ALERT_COLORS.quiet;
      const arrow = alert.direction === 'ABOVE' ? '\u25B2 \u2265' : '\u25BC \u2264';
      const word = alert.state === 'FIRED' ? 'Triggered' : alert.state === 'DISABLED' ? 'Off' : 'Alert';
      return {
        y: alert.threshold,
        borderColor: color,
        strokeDashArray: armed ? 5 : 2,
        opacity: alert.state === 'DISABLED' ? 0.5 : 1,
        label: {
          text: `${word} ${arrow} ${formatMoney(alert.threshold)}`,
          borderColor: color,
          position: 'left',
          textAnchor: 'start',
          offsetX: 6,
          style: { color: '#ffffff', background: color, fontSize: '11px', fontWeight: 600, padding: { left: 5, right: 5, top: 2, bottom: 2 } }
        }
      };
    });
    for (const level of this.orderLevels()) {
      const color = level.side === 'BUY' ? palette.up : palette.down;
      lines.push({
        y: level.price,
        borderColor: color,
        strokeDashArray: 8,
        borderWidth: 2,
        label: {
          text: level.label,
          borderColor: color,
          position: 'right',
          textAnchor: 'end',
          offsetX: -6,
          style: { color: '#ffffff', background: color, fontSize: '11px', fontWeight: 600, padding: { left: 5, right: 5, top: 2, bottom: 2 } }
        }
      });
    }
    const pending = this.pendingPrice();
    if (pending !== null) {
      lines.push({
        y: pending,
        borderColor: ALERT_COLORS.pending,
        strokeDashArray: 0,
        borderWidth: 2,
        label: {
          text: `${this.pendingLabel()} ${formatMoney(pending)}`,
          borderColor: ALERT_COLORS.pending,
          position: 'right',
          textAnchor: 'end',
          offsetX: -6,
          style: { color: '#ffffff', background: ALERT_COLORS.pending, fontSize: '11px', fontWeight: 700, padding: { left: 5, right: 5, top: 2, bottom: 2 } }
        }
      });
    }
    return lines;
  }

  private volumeOptions(candles: readonly Candle[], palette: ReturnType<typeof chartPalette>): ApexOptions {
    const options = this.base('price-volume', 100, palette);
    return {
      ...options,
      chart: { ...options.chart, type: 'bar' },
      series: [
        {
          name: 'Volume',
          type: 'bar',
          data: candles.map((c) => ({
            x: Date.parse(c.time),
            y: c.volume ?? 0,
            fillColor: c.close >= c.open ? palette.up : palette.down
          }))
        }
      ],
      plotOptions: { bar: { columnWidth: '70%' } },
      yaxis: { labels: { minWidth: 64, formatter: (v: number) => compact(v), style: { colors: palette.fore, fontSize: '11px' } } },
      tooltip: { ...options.tooltip, y: { formatter: (v: number) => v.toLocaleString('en-IN') } }
    };
  }

  private rsiOptions(candles: readonly Candle[], palette: ReturnType<typeof chartPalette>): ApexOptions {
    const times = candles.map((c) => Date.parse(c.time));
    const values = rsi(candles.map((c) => c.close), 14);
    const options = this.base('price-rsi', 120, palette);
    return {
      ...options,
      series: [{ name: 'RSI 14', type: 'line', data: values.map((v, i) => [times[i], v === null ? null : Math.round(v * 100) / 100]) }],
      colors: [COLORS.rsi],
      stroke: { curve: 'straight', width: 1.5 },
      yaxis: {
        min: 0,
        max: 100,
        tickAmount: 2,
        labels: { minWidth: 64, formatter: (v: number) => String(Math.round(v)), style: { colors: palette.fore, fontSize: '11px' } }
      },
      annotations: {
        yaxis: [
          { y: 70, borderColor: palette.down, strokeDashArray: 3, opacity: 0.6 },
          { y: 30, borderColor: palette.up, strokeDashArray: 3, opacity: 0.6 }
        ]
      }
    };
  }

  private macdOptions(candles: readonly Candle[], palette: ReturnType<typeof chartPalette>): ApexOptions {
    const times = candles.map((c) => Date.parse(c.time));
    const m = macd(candles.map((c) => c.close), 12, 26, 9);
    const options = this.base('price-macd', 140, palette);
    const round = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);
    return {
      ...options,
      series: [
        {
          name: 'Histogram',
          type: 'bar',
          data: m.histogram.map((v, i) => ({ x: times[i], y: round(v), fillColor: (v ?? 0) >= 0 ? palette.up : palette.down }))
        },
        { name: 'MACD', type: 'line', data: m.macd.map((v, i) => [times[i], round(v)]) },
        { name: 'Signal', type: 'line', data: m.signal.map((v, i) => [times[i], round(v)]) }
      ],
      colors: [palette.up, COLORS.macd, COLORS.signal],
      stroke: { curve: 'straight', width: [0, 1.5, 1.5] },
      plotOptions: { bar: { columnWidth: '60%' } },
      yaxis: { labels: { minWidth: 64, formatter: (v: number) => v.toFixed(2), style: { colors: palette.fore, fontSize: '11px' } } }
    };
  }
}

function compact(value: number): string {
  if (value >= 1e7) return `${(value / 1e7).toFixed(1)}Cr`;
  if (value >= 1e5) return `${(value / 1e5).toFixed(1)}L`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(Math.round(value));
}
