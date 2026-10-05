import { ApplicationRef, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { IndicatorId } from '../../core/charts/chart-options';
import { Candle } from '../../core/services/market.service';
import { THEME_STORAGE, ThemeService } from '../../core/theme/theme.service';
import { PriceChart } from './price-chart';

function candles(count: number, daily = false): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10 + i * 0.2;
    return {
      time: new Date(Date.UTC(2026, 0, 1) + i * (daily ? 86_400_000 : 300_000)).toISOString(),
      open: base,
      high: base + 2,
      low: base - 2,
      close: base + (i % 2 === 0 ? 1 : -1),
      volume: daily ? 1_000_000 + i * 1000 : null
    };
  });
}

@Component({
  imports: [PriceChart],
  template: `<tui-price-chart [candles]="candles()" [style]="style()" [indicators]="indicators()" [hasVolume]="hasVolume()" />`
})
class Host {
  readonly candles = signal<Candle[]>(candles(120));
  readonly style = signal<'candles' | 'line'>('candles');
  readonly indicators = signal<IndicatorId[]>([]);
  readonly hasVolume = signal(false);
}

describe('PriceChart', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ imports: [Host], providers: [{ provide: THEME_STORAGE, useValue: window.sessionStorage }] });
  });

  async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.autoDetectChanges(true);
    await settle(fixture);
    return fixture;
  }

  const el = (fixture: { nativeElement: unknown }, pane: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-testid="pane-${pane}"]`)!;
  const drawn = (fixture: { nativeElement: unknown }, pane: string) => el(fixture, pane).querySelector('.apexcharts-canvas') !== null;

  it('always draws the price pane, and no indicator panes until asked', async () => {
    const fixture = await render();

    expect(drawn(fixture, 'main')).toBe(true);
    expect([drawn(fixture, 'volume'), drawn(fixture, 'rsi'), drawn(fixture, 'macd')]).toEqual([false, false, false]);
    expect([el(fixture, 'volume').hidden, el(fixture, 'rsi').hidden, el(fixture, 'macd').hidden]).toEqual([true, true, true]);
  });

  it('draws RSI and MACD panes when they are turned on, and removes them when turned off', async () => {
    const fixture = await render();

    fixture.componentInstance.indicators.set(['rsi', 'macd']);
    await settle(fixture);
    expect(drawn(fixture, 'rsi')).toBe(true);
    expect(drawn(fixture, 'macd')).toBe(true);
    expect(el(fixture, 'rsi').hidden).toBe(false);

    fixture.componentInstance.indicators.set(['rsi']);
    await settle(fixture);
    expect(drawn(fixture, 'rsi')).toBe(true);
    expect(drawn(fixture, 'macd')).toBe(false);
    expect(el(fixture, 'macd').hidden).toBe(true);
  });

  it('draws volume only when the candles carry it', async () => {
    const fixture = await render();
    fixture.componentInstance.indicators.set(['volume']);
    await settle(fixture);
    expect(drawn(fixture, 'volume')).toBe(false);

    fixture.componentInstance.candles.set(candles(120, true));
    fixture.componentInstance.hasVolume.set(true);
    await settle(fixture);
    expect(drawn(fixture, 'volume')).toBe(true);
  });

  it('draws every overlay as a line over the price', async () => {
    const fixture = await render();
    fixture.componentInstance.indicators.set(['sma20', 'sma50', 'ema20', 'bollinger']);
    await settle(fixture);

    const names = Array.from(el(fixture, 'main').querySelectorAll('.apexcharts-legend-series, .apexcharts-series')).length;
    expect(drawn(fixture, 'main')).toBe(true);
    expect(names).toBeGreaterThan(1);
  });

  it('switches between candles and a line without breaking', async () => {
    const fixture = await render();

    fixture.componentInstance.style.set('line');
    await settle(fixture);

    expect(drawn(fixture, 'main')).toBe(true);
  });

  it('copes with no candles and with fewer candles than an indicator needs', async () => {
    const fixture = await render();
    fixture.componentInstance.indicators.set(['sma50', 'rsi', 'macd', 'bollinger']);

    fixture.componentInstance.candles.set([]);
    await settle(fixture);
    expect(drawn(fixture, 'main')).toBe(true);

    fixture.componentInstance.candles.set(candles(5));
    await settle(fixture);
    expect(drawn(fixture, 'main')).toBe(true);
  });

  it('redraws for the theme and tears everything down on destroy', async () => {
    const fixture = await render();
    fixture.componentInstance.indicators.set(['rsi']);
    await settle(fixture);

    TestBed.inject(ThemeService).set('dark');
    await settle(fixture);
    expect(drawn(fixture, 'main')).toBe(true);

    const root = fixture.nativeElement as HTMLElement;
    fixture.destroy();
    expect(root.querySelector('.apexcharts-canvas')).toBeNull();
  });
});
