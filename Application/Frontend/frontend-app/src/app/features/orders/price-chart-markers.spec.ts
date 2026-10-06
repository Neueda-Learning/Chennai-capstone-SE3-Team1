import { ApplicationRef, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import ApexCharts from 'apexcharts';

import { PlotGeometry } from '../../core/charts/price-axis';
import { Candle } from '../../core/services/market.service';
import { PriceAlert } from '../../core/services/watchlist.service';
import { THEME_STORAGE } from '../../core/theme/theme.service';
import { PriceChart } from './price-chart';

// A plot 300px tall starting 10px down and 60px in, spanning 100 to 200.
const GEOMETRY: PlotGeometry = { translateX: 60, translateY: 10, gridWidth: 500, gridHeight: 300, min: 100, max: 200 };

function candles(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 120 + Math.sin(i / 5) * 10;
    return {
      time: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
      open: base,
      high: base + 2,
      low: base - 2,
      close: base + 1,
      volume: null
    };
  });
}

function alert(id: string, overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id,
    symbol: 'TCS',
    threshold: 130,
    direction: 'ABOVE',
    state: 'ARMED',
    deliveryState: null,
    firedAt: null,
    firedPrice: null,
    createdAt: '2026-10-06T09:00:00Z',
    ...overrides
  };
}

@Component({
  imports: [PriceChart],
  template: `<tui-price-chart
    [candles]="candles()"
    [alerts]="alerts()"
    [markerMode]="markerMode()"
    [pendingPrice]="pending()"
    (markerPlaced)="placed.push($event)"
  />`
})
class Host {
  readonly candles = signal<Candle[]>(candles(60));
  readonly alerts = signal<PriceAlert[]>([]);
  readonly markerMode = signal(false);
  readonly pending = signal<number | null>(null);
  readonly placed: number[] = [];
}

describe('PriceChart alert markers', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const surface = (): HTMLElement => root().querySelector<HTMLElement>('[data-testid="chart-surface"]') as HTMLElement;
  const guide = (): HTMLElement | null => root().querySelector<HTMLElement>('[data-testid="marker-guide"]');
  const labels = (): string[] =>
    Array.from(root().querySelectorAll('.apexcharts-yaxis-annotation-label')).map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim());

  function pointer(type: string, x: number, y: number): MouseEvent {
    const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    surface().dispatchEvent(event);
    return event;
  }

  beforeEach(async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ imports: [Host], providers: [{ provide: THEME_STORAGE, useValue: window.sessionStorage }] });
    vi.spyOn(PriceChart.prototype as unknown as { geometry: () => PlotGeometry | null }, 'geometry').mockReturnValue(GEOMETRY);
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.autoDetectChanges(true);
    await settle();
  });

  afterEach(() => vi.restoreAllMocks());

  describe('alert lines', () => {
    it('draws a labelled line for each alert, saying which way it waits and at what price', async () => {
      host.alerts.set([alert('a', { threshold: 130, direction: 'ABOVE' }), alert('b', { threshold: 110, direction: 'BELOW' })]);
      await settle();

      const text = labels();
      expect(text.some((l) => l.includes('Alert') && l.includes('130.00') && l.includes('▲'))).toBe(true);
      expect(text.some((l) => l.includes('Alert') && l.includes('110.00') && l.includes('▼'))).toBe(true);
    });

    it('labels a triggered alert and a switched-off one differently from a watching one', async () => {
      host.alerts.set([
        alert('fired', { threshold: 125, state: 'FIRED' }),
        alert('off', { threshold: 115, state: 'DISABLED' })
      ]);
      await settle();

      expect(labels().some((l) => l.startsWith('Triggered') && l.includes('125.00'))).toBe(true);
      expect(labels().some((l) => l.startsWith('Off') && l.includes('115.00'))).toBe(true);
    });

    it('removes a line when its alert goes, instead of leaving it behind', async () => {
      host.alerts.set([alert('a', { threshold: 130 }), alert('b', { threshold: 111 })]);
      await settle();
      expect(labels().filter((l) => l.includes('111.00'))).toHaveLength(1);

      host.alerts.set([alert('a', { threshold: 130 })]);
      await settle();

      expect(labels().some((l) => l.includes('111.00'))).toBe(false);
      expect(labels().some((l) => l.includes('130.00'))).toBe(true);
    });

    it('draws the marker being placed, and clears it when it is confirmed or cancelled', async () => {
      host.pending.set(128.5);
      await settle();
      expect(labels().some((l) => l.startsWith('New alert') && l.includes('128.50'))).toBe(true);

      host.pending.set(null);
      await settle();
      expect(labels().some((l) => l.startsWith('New alert'))).toBe(false);
    });
  });

  describe('placing a marker', () => {
    it('does nothing at all while marker mode is off', async () => {
      pointer('mousemove', 200, 150);
      pointer('click', 200, 150);
      await settle();

      expect(guide()).toBeNull();
      expect(host.placed).toEqual([]);
      expect(surface().classList.contains('marker-mode')).toBe(false);
    });

    it('turns the hover tooltip off in marker mode, so the guide is the only price readout, and back on after', async () => {
      const tooltipOn = (): boolean | undefined =>
        (ApexCharts.getChartByID('price-main') as unknown as { w: { config: { tooltip: { enabled: boolean } } } } | undefined)?.w.config.tooltip.enabled;
      expect(tooltipOn()).toBe(true);

      host.markerMode.set(true);
      await settle();
      expect(tooltipOn()).toBe(false);

      host.markerMode.set(false);
      await settle();
      expect(tooltipOn()).toBe(true);
    });

    it('shows a crosshair cursor in marker mode', async () => {
      host.markerMode.set(true);
      await settle();

      expect(surface().classList.contains('marker-mode')).toBe(true);
    });

    it('shows a guide line with the price under the pointer', async () => {
      host.markerMode.set(true);
      await settle();

      pointer('mousemove', 200, 160); // halfway down the plot: 150

      await settle();
      expect(guide()).not.toBeNull();
      expect(guide()?.querySelector('[data-testid="marker-guide-price"]')?.textContent).toContain('150.00');
      expect(guide()?.style.top).toBe('160px');
      expect(guide()?.style.left).toBe('60px');
      expect(guide()?.style.width).toBe('500px');
    });

    it('follows the pointer, and goes when it leaves the chart', async () => {
      host.markerMode.set(true);
      await settle();

      pointer('mousemove', 200, 85); // a quarter of the way down: 175
      await settle();
      expect(guide()?.textContent).toContain('175.00');

      pointer('mouseleave', 200, 85);
      await settle();
      expect(guide()).toBeNull();
    });

    it('shows no guide, and places nothing, over the axes or title', async () => {
      host.markerMode.set(true);
      await settle();

      for (const [x, y] of [[200, 5], [200, 320], [30, 100], [600, 100]]) {
        pointer('mousemove', x, y);
        pointer('click', x, y);
      }
      await settle();

      expect(guide()).toBeNull();
      expect(host.placed).toEqual([]);
    });

    it('reports the price at the clicked height', async () => {
      host.markerMode.set(true);
      await settle();

      pointer('click', 200, 10);  // the top of the plot: 200
      pointer('click', 200, 310); // the bottom: 100
      pointer('click', 200, 160); // the middle: 150

      expect(host.placed).toEqual([200, 100, 150]);
    });

    it('does nothing when the chart has not been laid out yet', async () => {
      vi.mocked((PriceChart.prototype as unknown as { geometry: () => PlotGeometry | null }).geometry).mockReturnValue(null);
      host.markerMode.set(true);
      await settle();

      pointer('mousemove', 200, 160);
      pointer('click', 200, 160);
      await settle();

      expect(guide()).toBeNull();
      expect(host.placed).toEqual([]);
    });

    it('stops showing the guide the moment marker mode is switched off', async () => {
      host.markerMode.set(true);
      await settle();
      pointer('mousemove', 200, 160);
      await settle();
      expect(guide()).not.toBeNull();

      host.markerMode.set(false);
      await settle();

      expect(guide()).toBeNull();
    });
  });
});
