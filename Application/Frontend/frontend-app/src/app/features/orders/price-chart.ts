import { Component, ElementRef, OnDestroy, afterRenderEffect, computed, inject, input, viewChild } from '@angular/core';
import ApexCharts from 'apexcharts';
import type { ApexAxisChartSeries, ApexOptions } from 'apexcharts';

import { chartPalette } from '../../core/charts/chart-theme';
import { IndicatorId } from '../../core/charts/chart-options';
import { bollinger, ema, macd, rsi, sma } from '../../core/charts/indicators';
import { formatMoney } from '../../core/format/money';
import { Candle } from '../../core/services/market.service';
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

@Component({
  selector: 'tui-price-chart',
  templateUrl: './price-chart.html'
})
export class PriceChart implements OnDestroy {
  readonly candles = input.required<readonly Candle[]>();
  readonly style = input<'candles' | 'line'>('candles');
  readonly indicators = input<readonly IndicatorId[]>([]);
  readonly hasVolume = input(false);

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

      this.sync('main', this.mainEl().nativeElement, true, () => this.mainOptions(candles, indicators, palette));
      this.sync('volume', this.volumeEl().nativeElement, show.volume, () => this.volumeOptions(candles, palette));
      this.sync('rsi', this.rsiEl().nativeElement, show.rsi, () => this.rsiOptions(candles, palette));
      this.sync('macd', this.macdEl().nativeElement, show.macd, () => this.macdOptions(candles, palette));
    });
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

    const drawn: number[] = candles.flatMap((c) => [c.low, c.high]);
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
      yaxis: {
        min: lo === undefined ? undefined : lo - pad,
        max: hi === undefined ? undefined : hi + pad,
        forceNiceScale: false,
        decimalsInFloat: 2,
        labels: { minWidth: 64, formatter: (v: number) => formatMoney(v), style: { colors: palette.fore, fontSize: '11px' } }
      },
      tooltip: { ...options.tooltip, y: { formatter: (v: number) => (v === undefined || v === null ? '' : formatMoney(v)) } }
    };
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
