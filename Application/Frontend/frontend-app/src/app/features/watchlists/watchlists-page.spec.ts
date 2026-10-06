import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { SessionStore } from '../../core/auth/session.store';
import { PriceAlert, Watchlist } from '../../core/services/watchlist.service';
import { REFRESH_MS } from '../../core/watchlists/watchlist.store';
import { THEME_STORAGE } from '../../core/theme/theme.service';
import { provideApi } from '../../generated/trade-client';
import { CATALOG_REFRESH_MS, WatchlistsPage } from './watchlists-page';

const TRADE = 'http://trade.test';
const ACCOUNT = `${TRADE}/api/v1/accounts/42`;
const QUOTES_URL = `${TRADE}/api/v1/market/quotes`;
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';
const LIST_ID = '6f1c1c0e-8c1e-4d3b-9a43-0d4f1f0d2a11';

function quote(symbol: string, name: string, price: number, changePercent = 0.5) {
  return { symbol, name, price, bid: null, ask: null, currency: 'INR', change: 1, changePercent, previousClose: price - 1, marketState: 'OPEN', stale: false, quoteAsOf: null, receivedAt: null };
}

const QUOTES = [quote('HDFCBANK', 'HDFC Bank', 1700), quote('INFY', 'Infosys', 1620), quote('TCS', 'Tata Consultancy Services', 3000)];

function watchlist(): Watchlist {
  return {
    id: LIST_ID,
    name: 'Banks',
    createdAt: '2026-10-06T09:15:00Z',
    instruments: [{ symbol: 'HDFCBANK', name: 'HDFC Bank', price: 1650.5, currency: 'INR', changePercent: 0.09, stale: false, quoteAsOf: null }]
  };
}

function alert(id: string, overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id,
    symbol: 'TCS',
    threshold: 3150,
    direction: 'ABOVE',
    state: 'ARMED',
    deliveryState: null,
    firedAt: null,
    firedPrice: null,
    createdAt: '2026-10-06T09:00:00Z',
    ...overrides
  };
}

describe('WatchlistsPage', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<WatchlistsPage>;
  let params: BehaviorSubject<ParamMap>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string): T | null => root().querySelector<T>(`[data-testid="${id}"]`);
  const all = (id: string): HTMLElement[] => Array.from(root().querySelectorAll(`[data-testid="${id}"]`));
  const text = (el: HTMLElement | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function setUp(options: { lists?: Watchlist[]; alerts?: PriceAlert[]; query?: Record<string, string> } = {}): Promise<void> {
    params = new BehaviorSubject(convertToParamMap(options.query ?? {}));
    TestBed.configureTestingModule({
      imports: [WatchlistsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: TRADE }),
        provideRouter([]),
        { provide: THEME_STORAGE, useValue: window.sessionStorage },
        { provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } }
      ]
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).signIn(TOKEN, null, null);
    fixture = TestBed.createComponent(WatchlistsPage);
    fixture.detectChanges();
    http.expectOne(`${ACCOUNT}/watchlists`).flush(options.lists ?? [watchlist()]);
    http.expectOne(`${ACCOUNT}/alerts`).flush(options.alerts ?? []);
    http.expectOne(QUOTES_URL).flush(QUOTES);
    await settle();
  }

  afterEach(() => {
    fixture?.destroy();
    http?.verify();
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('watchlists', () => {
    it('shows a card for each watchlist, with its entries', async () => {
      await setUp();

      expect(all('watchlist-title').map(text)).toEqual(['Banks']);
      expect(all('entry-symbol').map((cell) => cell.querySelector('strong')?.textContent?.trim())).toEqual(['HDFCBANK']);
      expect(text(all('entry-symbol')[0])).toContain('HDFC Bank'); // the name sits under the symbol in the narrow column
    });

    it('says so, and prompts to create one, when there are none', async () => {
      await setUp({ lists: [] });

      expect(q('watchlist-empty')).not.toBeNull();
      expect(q('watchlist-loading')).toBeNull();
    });

    it('creates a watchlist from the name typed, and empties the box', async () => {
      await setUp({ lists: [] });
      const box = q<HTMLInputElement>('watchlist-name') as HTMLInputElement;
      box.value = '  Tech  ';
      box.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      q('watchlist-create')?.click();
      const request = http.expectOne(`${ACCOUNT}/watchlists`);
      expect(request.request.body).toEqual({ name: 'Tech' });
      request.flush({ ...watchlist(), name: 'Tech' });
      await settle();

      expect(all('watchlist-title').map(text)).toEqual(['Tech']);
      expect(box.value).toBe('');
    });

    it('creates on Enter, and keeps the name when it is refused, saying why', async () => {
      await setUp({ lists: [] });
      const box = q<HTMLInputElement>('watchlist-name') as HTMLInputElement;
      box.value = 'Banks';
      box.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      http.expectOne(`${ACCOUNT}/watchlists`).flush({ errorCode: 'WLT-409', message: 'x' }, { status: 409, statusText: 'Conflict' });
      await settle();

      expect(text(q('watchlist-error'))).toContain('already have a watchlist');
      expect(box.value).toBe('Banks');
    });
  });

  describe('price alerts', () => {
    it('asks for a stock first, and shows no chart until one is chosen', async () => {
      await setUp();

      expect(q('alert-chart-prompt')).not.toBeNull();
      expect(q('alert-chart')).toBeNull();
    });

    it('offers every instrument in a search box, and opens that stock\'s chart when one is picked', async () => {
      await setUp();
      (q('alert-picker-input') as HTMLInputElement).dispatchEvent(new Event('focus'));
      await settle();

      expect(all('picker-option-TCS')).toHaveLength(1);
      (q('picker-option-TCS') as HTMLElement).click();
      await settle();

      http.expectOne(`${TRADE}/api/v1/market/quotes/TCS/candles?interval=1d&range=1mo`).flush([]);
      await settle();
      expect(text(q('alert-chart-title'))).toContain('TCS');
      expect(text(q('alert-chart-title'))).toContain('Tata Consultancy Services');
      expect(q('alert-chart-prompt')).toBeNull();
      expect(q('marker-toggle')).not.toBeNull();
    });

    it('opens a stock named in the address (the bell beside a watchlist entry)', async () => {
      await setUp({ query: { alert: 'infy' } });

      http.expectOne(`${TRADE}/api/v1/market/quotes/INFY/candles?interval=1d&range=1mo`).flush([]);
      await settle();

      expect(text(q('alert-chart-title'))).toContain('INFY');
    });

    it('follows the address when it changes while the page is open', async () => {
      await setUp();

      params.next(convertToParamMap({ alert: 'TCS' }));
      await settle();

      http.expectOne(`${TRADE}/api/v1/market/quotes/TCS/candles?interval=1d&range=1mo`).flush([]);
    });

    it('drops a stock named in the address that is not one that can be traded, and abandons its chart', async () => {
      await setUp({ query: { alert: 'NOSUCH' } });

      const request = http.expectOne(`${TRADE}/api/v1/market/quotes/NOSUCH/candles?interval=1d&range=1mo`);
      await settle();

      expect(request.cancelled).toBe(true);
      expect(q('alert-chart')).toBeNull();
      expect(q('alert-chart-prompt')).not.toBeNull();
    });

    it('lists all the alerts, with how far each is from its level using the latest price', async () => {
      await setUp({ alerts: [alert('a1', { threshold: 3150 })] });

      expect(text(q('alert-threshold'))).toContain('3,150.00');
      expect(text(q('alert-distance'))).toBe('5.0% to go');
    });

    it('opens a stock\'s chart when its symbol is clicked in the list', async () => {
      await setUp({ alerts: [alert('a1')] });

      q('alert-symbol')?.click();
      await settle();

      http.expectOne(`${TRADE}/api/v1/market/quotes/TCS/candles?interval=1d&range=1mo`).flush([]);
      await settle();
      expect(text(q('alert-chart-title'))).toContain('TCS');
    });

    it('says why the alerts could not be loaded when there are none to show', async () => {
      params = new BehaviorSubject(convertToParamMap({}));
      TestBed.configureTestingModule({
        imports: [WatchlistsPage],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideApi({ basePath: TRADE }),
          provideRouter([]),
          { provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } }
        ]
      });
      http = TestBed.inject(HttpTestingController);
      TestBed.inject(SessionStore).signIn(TOKEN, null, null);
      fixture = TestBed.createComponent(WatchlistsPage);
      fixture.detectChanges();
      http.expectOne(`${ACCOUNT}/watchlists`).flush([watchlist()]);
      http.expectOne(`${ACCOUNT}/alerts`).flush({ errorCode: 'INTERNAL-500', message: 'x' }, { status: 500, statusText: 'Error' });
      http.expectOne(QUOTES_URL).flush(QUOTES);
      await settle();

      expect(q('alert-error')).not.toBeNull();
    });
  });

  describe('keeping fresh', () => {
    it('refreshes the instrument prices every minute, and the lists every half minute', async () => {
      vi.useFakeTimers();
      await setUp();

      vi.advanceTimersByTime(REFRESH_MS);
      http.expectOne(`${ACCOUNT}/watchlists`).flush([watchlist()]);
      http.expectOne(`${ACCOUNT}/alerts`).flush([]);

      vi.advanceTimersByTime(CATALOG_REFRESH_MS - REFRESH_MS);
      http.expectOne(QUOTES_URL).flush(QUOTES);
      http.expectOne(`${ACCOUNT}/watchlists`).flush([watchlist()]);
      http.expectOne(`${ACCOUNT}/alerts`).flush([]);
    });

    it('stops polling when the page is left', async () => {
      vi.useFakeTimers();
      await setUp();

      fixture.destroy();
      vi.advanceTimersByTime(CATALOG_REFRESH_MS * 3);

      http.expectNone(`${ACCOUNT}/watchlists`);
      http.expectNone(QUOTES_URL);
    });
  });
});
