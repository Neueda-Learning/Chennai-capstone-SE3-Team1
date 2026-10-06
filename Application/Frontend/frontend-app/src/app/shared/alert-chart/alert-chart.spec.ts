import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlotGeometry } from '../../core/charts/price-axis';
import { SessionStore } from '../../core/auth/session.store';
import { PriceAlert } from '../../core/services/watchlist.service';
import { WatchlistStore } from '../../core/watchlists/watchlist.store';
import { THEME_STORAGE } from '../../core/theme/theme.service';
import { provideApi } from '../../generated/trade-client';
import { PriceChart } from '../../features/orders/price-chart';
import { AlertChart } from './alert-chart';

const TRADE = 'http://trade.test';
const ACCOUNT = `${TRADE}/api/v1/accounts/42`;
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';
const GEOMETRY: PlotGeometry = { translateX: 60, translateY: 10, gridWidth: 500, gridHeight: 300, min: 100, max: 200 };

const CANDLES = Array.from({ length: 30 }, (_, i) => ({
  time: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
  open: 150,
  high: 152,
  low: 148,
  close: 150 + (i % 3),
  volume: null
}));

function alert(id: string, overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id,
    symbol: 'TCS',
    threshold: 160,
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
  imports: [AlertChart],
  template: `<tui-alert-chart [symbol]="symbol()" name="Tata Consultancy" [currentPrice]="price()" />`
})
class Host {
  readonly symbol = signal('TCS');
  readonly price = signal<number | null>(151);
}

describe('AlertChart', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let http: HttpTestingController;
  let store: WatchlistStore;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string): T | null => root().querySelector<T>(`[data-testid="${id}"]`);
  const text = (id: string): string => (q(id)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const candleUrl = (symbol: string, interval: string, range: string) =>
    `${TRADE}/api/v1/market/quotes/${symbol}/candles?interval=${interval}&range=${range}`;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 60));
    fixture.detectChanges();
  }

  async function setUp(alerts: PriceAlert[] = []): Promise<TestRequest> {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: TRADE }),
        { provide: THEME_STORAGE, useValue: window.sessionStorage }
      ]
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).signIn(TOKEN, null, null);
    store = TestBed.inject(WatchlistStore);
    store.start();
    http.expectOne(`${ACCOUNT}/watchlists`).flush([]);
    http.expectOne(`${ACCOUNT}/alerts`).flush(alerts);
    vi.spyOn(PriceChart.prototype as unknown as { geometry: () => PlotGeometry | null }, 'geometry').mockReturnValue(GEOMETRY);
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.autoDetectChanges(true);
    await settle();
    return http.expectOne(candleUrl('TCS', '1d', '1mo'));
  }

  afterEach(() => {
    store?.stop();
    http?.verify();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('loads a month of daily candles for the stock to begin with, and shows its name', async () => {
    const request = await setUp();
    expect(text('alert-chart-loading')).toContain('Loading');

    request.flush(CANDLES);
    await settle();

    expect(text('alert-chart-title')).toContain('TCS');
    expect(text('alert-chart-title')).toContain('Tata Consultancy');
    expect(q('alert-chart-loading')).toBeNull();
    expect(root().querySelector('.apexcharts-canvas')).not.toBeNull();
  });

  it('puts the alert panel beside the chart, in the same split, not underneath it', async () => {
    (await setUp()).flush(CANDLES);
    await settle();

    const split = root().querySelector('.alert-split') as HTMLElement;
    const panel = q('alert-panel') as HTMLElement;
    expect(panel.parentElement).toBe(split);
    expect(split.children[0].querySelector('.apexcharts-canvas')).not.toBeNull(); // chart first
    expect(split.children[1]).toBe(panel); // panel second, to its right
    expect(panel.querySelector('[data-testid="marker-toggle"]')).not.toBeNull();
  });

  it('reloads when another span is chosen, using a candle size that suits it', async () => {
    (await setUp()).flush(CANDLES);
    await settle();

    q('alert-chart-range-1D')?.click();
    await settle();
    http.expectOne(candleUrl('TCS', '5m', '1d')).flush(CANDLES);

    q('alert-chart-range-1Y')?.click();
    await settle();
    http.expectOne(candleUrl('TCS', '1d', '1y')).flush(CANDLES);
    await settle();

    expect(q('alert-chart-range-1Y')?.classList.contains('active')).toBe(true);
    expect(q('alert-chart-range-1D')?.classList.contains('active')).toBe(false);
  });

  it('reloads when the stock changes', async () => {
    (await setUp()).flush(CANDLES);
    await settle();

    host.symbol.set('INFY');
    await settle();

    http.expectOne(candleUrl('INFY', '1d', '1mo')).flush(CANDLES);
  });

  it('says so when the chart cannot be loaded, and still offers entering a price', async () => {
    (await setUp()).flush({}, { status: 500, statusText: 'Error' });
    await settle();

    expect(text('alert-chart-failed')).toContain('entering a price');
    expect(q('by-price')).not.toBeNull();
  });

  it('says so when there are no prices for the span yet', async () => {
    (await setUp()).flush([]);
    await settle();

    expect(text('alert-chart-empty')).toContain('No prices');
  });

  it('shows this stock\'s alerts in the panel under the chart, and no other stock\'s', async () => {
    (await setUp([alert('mine'), alert('theirs', { symbol: 'INFY' })])).flush(CANDLES);
    await settle();

    expect(q('composer-alert-mine')).not.toBeNull();
    expect(q('composer-alert-theirs')).toBeNull();
  });

  it('turns a click on the chart into a marker the panel offers to confirm', async () => {
    (await setUp()).flush(CANDLES);
    await settle();
    q('marker-toggle')?.click();
    await settle();

    const surface = q('chart-surface') as HTMLElement;
    surface.dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 85, bubbles: true })); // a quarter down: 175
    await settle();

    expect((q<HTMLInputElement>('composer-price') as HTMLInputElement).value).toBe('175.00');
    expect(text('composer-direction')).toBe('rises to or above');
  });

  it('sets the alert from a marker with the right way round, and the chart then shows it', async () => {
    (await setUp()).flush(CANDLES);
    await settle();
    q('marker-toggle')?.click();
    await settle();
    (q('chart-surface') as HTMLElement).dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 235, bubbles: true })); // 125
    await settle();

    q('composer-confirm')?.click();
    const request = http.expectOne(`${ACCOUNT}/alerts`);
    expect(request.request.body).toEqual({ symbol: 'TCS', threshold: 125, direction: 'BELOW' });
    request.flush(alert('new', { threshold: 125, direction: 'BELOW' }));
    await settle();

    expect(q('composer-alert-new')).not.toBeNull();
    const labels = Array.from(root().querySelectorAll('.apexcharts-yaxis-annotation-label')).map((e) => e.textContent ?? '');
    expect(labels.some((l) => l.includes('125.00'))).toBe(true);
  });

  it('does not place markers unless marker mode is on', async () => {
    (await setUp()).flush(CANDLES);
    await settle();

    (q('chart-surface') as HTMLElement).dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 85, bubbles: true }));
    await settle();

    expect(q('composer-form')).toBeNull();
  });
});
