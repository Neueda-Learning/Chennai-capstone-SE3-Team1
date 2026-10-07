import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { NotificationStore } from '../../core/notifications/notification.store';
import { THEME_STORAGE } from '../../core/theme/theme.service';
import { provideApi } from '../../generated/trade-client';
import { FakeApi } from '../../testing/fake-api';
import { DashboardPage } from './dashboard-page';

const ACCOUNT_ID = 7;
const BASE = 'http://trade.test';

const hoursAgo = (hours: number) => {
  const d = new Date(Date.now() - hours * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function order(overrides: Record<string, unknown>) {
  return {
    orderId: 'ORD-1',
    accountId: ACCOUNT_ID,
    symbol: 'RELIANCE',
    side: 'BUY',
    quantity: 10,
    price: 1325,
    executedPrice: 1300,
    status: 'FILLED',
    createdOn: hoursAgo(2),
    ...overrides
  };
}

const ORDERS = [
  order({ orderId: 'ORD-1', symbol: 'RELIANCE', side: 'BUY', quantity: 10, executedPrice: 1300, status: 'FILLED', createdOn: hoursAgo(2) }),
  order({ orderId: 'ORD-2', symbol: 'TCS', side: 'SELL', quantity: 2, price: 3250, executedPrice: 3300, status: 'FILLED', createdOn: hoursAgo(5) }),
  order({ orderId: 'ORD-3', symbol: 'ITC', side: 'BUY', quantity: 100, price: 400, executedPrice: null, status: 'REJECTED', createdOn: hoursAgo(30) }),
  order({ orderId: 'ORD-4', symbol: 'INFY', side: 'BUY', quantity: 1, price: 1500, executedPrice: null, status: 'NEW', createdOn: hoursAgo(1) }),
  order({ orderId: 'ORD-5', symbol: 'INFY', side: 'BUY', quantity: 1, price: 1500, executedPrice: null, status: 'CANCELLED', createdOn: hoursAgo(40) })
];

const QUOTES = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', price: 1300, bid: 1299, ask: 1301, currency: 'INR', change: 10, changePercent: 0.77, previousClose: 1290, marketState: 'REGULAR', stale: false, quoteAsOf: null, receivedAt: null },
  { symbol: 'TCS', name: 'Tata Consultancy Services', price: 3300, bid: 3299, ask: 3301, currency: 'INR', change: -20, changePercent: -0.6, previousClose: 3320, marketState: 'REGULAR', stale: false, quoteAsOf: null, receivedAt: null }
];

const PORTFOLIO = {
  accountId: ACCOUNT_ID,
  holdings: [
    { accountId: ACCOUNT_ID, symbol: 'RELIANCE', quantity: 10, averageCost: 1250, overallGains: 500 },
    { accountId: ACCOUNT_ID, symbol: 'TCS', quantity: 5, averageCost: 3400, overallGains: -500 }
  ],
  positions: []
};

function alertOn(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    symbol: 'TCS',
    threshold: 3465,
    direction: 'ABOVE',
    state: 'ARMED',
    deliveryState: null,
    firedAt: null,
    firedPrice: null,
    createdAt: '2026-10-06T09:00:00Z',
    ...overrides
  };
}

function watchlistOf(id: string, name: string, symbols: string[]) {
  return {
    id,
    name,
    createdAt: '2026-10-06T09:15:00Z',
    instruments: symbols.map((symbol) => ({ symbol, name: symbol + ' Ltd', price: 100, currency: 'INR', changePercent: 0.5, stale: false, quoteAsOf: null }))
  };
}

describe('DashboardPage', () => {
  let http: HttpTestingController;
  let api: FakeApi;

  const ADVICE = {
    accountId: ACCOUNT_ID,
    model: 'm1',
    methodology: 'rules',
    disclaimer: 'Information, not advice',
    generatedAt: '2026-10-06T18:00:00',
    dataAsOf: '2026-10-06',
    stale: false,
    signals: [],
    ideas: {
      buy: [{ symbol: 'TCS', suggestion: 'BUY', confidence: 'HIGH', score: 70, summary: 'BUY (high confidence)', status: 'OK', sources: [], reasons: [] }],
      sell: []
    }
  };

  function setUp(accountId: number | null = ACCOUNT_ID): void {
    TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: BASE }),
        { provide: THEME_STORAGE, useValue: window.sessionStorage }
      ]
    });
    if (accountId !== null) {
      TestBed.inject(SessionStore).signIn('token', accountId);
    }
    http = TestBed.inject(HttpTestingController);
    api = new FakeApi(http)
      .get(`/accounts/${ACCOUNT_ID}/balance`, { accountId: ACCOUNT_ID, cashBalance: 50000, currency: 'INR', asOf: '2026-02-14T10:15:30Z' })
      .get(`/accounts/${ACCOUNT_ID}/portfolio`, PORTFOLIO)
      .get(`/accounts/${ACCOUNT_ID}/orders`, ORDERS)
      .get(`/accounts/${ACCOUNT_ID}/watchlists`, [])
      .get(`/accounts/${ACCOUNT_ID}/alerts`, [])
      .get('/market/quotes', QUOTES)
      .get(`/accounts/${ACCOUNT_ID}/advice`, ADVICE);
  }

  function create(): ComponentFixture<DashboardPage> {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    settle(fixture);
    return fixture;
  }

  function settle(fixture: ComponentFixture<DashboardPage>): void {
    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    api.flush();
    fixture.detectChanges();
  }

  const text = (fixture: ComponentFixture<DashboardPage>, testId: string): string =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    http?.verify();
    vi.useRealTimers();
  });

  it('should create and render its charts', () => {
    setUp();
    const fixture = create();

    expect(fixture.componentInstance).toBeTruthy();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Dashboard');
    expect(compiled.querySelector('.apexcharts-canvas')).not.toBeNull();
  });

  it('should render its key summary cards', () => {
    setUp();
    const fixture = create();

    const titles = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.card-title')).map((el) => el.textContent?.trim());
    expect(titles).toEqual(expect.arrayContaining(['Watchlist', 'Recent Orders', 'Price Alerts', 'Portfolio Allocation']));
  });

  describe('real numbers', () => {
    it('values the portfolio as cash plus holdings at the latest quotes', () => {
      setUp();
      const fixture = create();

      expect(text(fixture, 'portfolio-value')).toContain('79,500.00');
      expect(text(fixture, 'cash')).toContain('50,000.00');
      expect(text(fixture, 'invested')).toContain('29,500.00');
    });

    it('reports the unrealised gain against what was paid', () => {
      setUp();
      const fixture = create();

      expect(text(fixture, 'unrealised')).toContain('0.00');
    });

    it('reports a gain when the prices are above cost', () => {
      setUp();
      api.set('/market/quotes', [{ ...QUOTES[0], price: 1400 }, QUOTES[1]]);
      const fixture = create();

      expect(text(fixture, 'unrealised')).toContain('+₹1,000.00');
      expect(text(fixture, 'unrealised')).toContain('+3.39%');
      expect(text(fixture, 'headline')).toContain('up 3.39%');
    });

    it("reports today's move from the quotes' change", () => {
      setUp();
      const fixture = create();

      expect(text(fixture, 'day-pnl')).toContain('0.00');

      api.set('/market/quotes', [QUOTES[0], { ...QUOTES[1], change: -30 }]);
      vi.advanceTimersByTime(60_000);
      fixture.detectChanges();
      settle(fixture);
      expect(text(fixture, 'day-pnl')).toContain('-₹50.00');
    });

    it('prices a holding from its stored gain when there is no quote for it yet', () => {
      setUp();
      api.set('/market/quotes', []);
      const fixture = create();

      expect(text(fixture, 'invested')).toContain('29,500.00');
    });

    it('lists the most recent orders, newest first, with what they moved', () => {
      setUp();
      const fixture = create();

      const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="recent-order"]')).map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');
      expect(rows).toHaveLength(5);
      expect(rows[0]).toContain('BUY 1 INFY');
      expect(rows[1]).toContain('BUY 10 RELIANCE');
      expect(rows[1]).toContain('13,000.00');
      expect(rows[2]).toContain('SELL 2 TCS');
      expect(rows[2]).toContain('+₹6,600.00');
    });

    it('draws one allocation slice per holding plus cash', () => {
      setUp();
      const fixture = create();

      const legend = text(fixture, 'allocation-legend');
      expect(legend).toContain('RELIANCE');
      expect(legend).toContain('TCS');
      expect(legend).toContain('Cash');
      expect(legend).toContain('62.9%');
    });

    it('contains none of the old placeholder figures', () => {
      setUp();
      const fixture = create();

      const page = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(page).not.toContain('5,40,000');
      expect(page).not.toContain('8,200');
      expect(page).not.toContain('Partially Filled');
      expect(page).not.toContain('Crypto');
    });
  });

  it('points "View portfolio" at the portfolio page', () => {
    setUp();
    const fixture = create();

    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('[data-testid="view-portfolio"]')!;
    expect(link.getAttribute('href')).toBe('/portfolio');
  });

  it('shows an empty state for an account with nothing in it', () => {
    setUp();
    api.set(`/accounts/${ACCOUNT_ID}/portfolio`, { accountId: ACCOUNT_ID, holdings: [], positions: [] });
    api.set(`/accounts/${ACCOUNT_ID}/orders`, []);
    const fixture = create();

    expect(text(fixture, 'headline')).toContain('No holdings yet');
    expect(text(fixture, 'recent-orders-empty')).toContain('not placed any orders');
    expect(text(fixture, 'portfolio-value')).toContain('50,000.00');
  });

  it('reloads straight away when a notification says something happened, without waiting a minute', () => {
    setUp();
    const fixture = create();
    const before = api.count('/balance');

    TestBed.inject(NotificationStore)['changesSignal'].update((n: number) => n + 1);
    fixture.detectChanges();
    settle(fixture);

    expect(api.count('/balance')).toBe(before + 1);
    expect(text(fixture, 'portfolio-value')).toContain('79,500.00');
  });

  it('refreshes by itself every minute', () => {
    setUp();
    const fixture = create();
    const before = api.count('/balance');

    vi.advanceTimersByTime(60_000);
    fixture.detectChanges();
    settle(fixture);

    expect(api.count('/balance')).toBe(before + 1);
  });

  describe('watchlist and price alerts (in place of the order flow and order summary)', () => {
    const q = (fixture: ComponentFixture<DashboardPage>, testId: string) =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    const all = (fixture: ComponentFixture<DashboardPage>, testId: string) =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));

    it('no longer shows the order flow chart, its range picker, or the order summary', () => {
      setUp();
      const fixture = create();
      const page = fixture.nativeElement as HTMLElement;

      expect(page.textContent).not.toContain('Order Flow');
      expect(page.textContent).not.toContain('Order Summary');
      expect(q(fixture, 'range-select')).toBeNull();
      expect(q(fixture, 'order-flow-empty')).toBeNull();
    });

    it('shows the watchlist section where the order flow was, and the alerts card where the summary was', () => {
      setUp();
      const fixture = create();

      expect(q(fixture, 'dashboard-watchlists')).not.toBeNull();
      expect(q(fixture, 'dashboard-alerts')).not.toBeNull();
      expect(q(fixture, 'manage-watchlists')?.getAttribute('href')).toBe('/app/watchlists');
      expect(q(fixture, 'manage-alerts')?.getAttribute('href')).toBe('/app/watchlists');
    });

    it('shows the first watchlist, with a live price against each entry', () => {
      setUp();
      api.set(`/accounts/${ACCOUNT_ID}/watchlists`, [watchlistOf('w1', 'Banks', ['HDFCBANK', 'ICICIBANK'])]);
      const fixture = create();

      expect(all(fixture, 'entry-symbol').map((e) => e.textContent?.replace(/\s+/g, ' ').trim())).toEqual(
        expect.arrayContaining([expect.stringContaining('HDFCBANK'), expect.stringContaining('ICICIBANK')])
      );
      expect(q(fixture, 'watchlist-tab-w1')).toBeNull(); // one list needs no tabs
    });

    it('offers tabs when there are several watchlists, and switches between them', () => {
      setUp();
      api.set(`/accounts/${ACCOUNT_ID}/watchlists`, [watchlistOf('w1', 'Banks', ['HDFCBANK']), watchlistOf('w2', 'Tech', ['TCS', 'INFY'])]);
      const fixture = create();

      expect(all(fixture, 'entry-symbol')).toHaveLength(1);
      expect(q(fixture, 'watchlist-tab-w1')?.classList.contains('active')).toBe(true);

      q(fixture, 'watchlist-tab-w2')?.click();
      fixture.detectChanges();

      expect(q(fixture, 'watchlist-tab-w2')?.classList.contains('active')).toBe(true);
      expect(all(fixture, 'entry-symbol')).toHaveLength(2);
    });

    it('lets a customer with no watchlist create one right on the dashboard', () => {
      setUp();
      const fixture = create();
      expect(q(fixture, 'dashboard-watchlist-empty')).not.toBeNull();

      const box = q(fixture, 'dashboard-watchlist-name') as HTMLInputElement;
      box.value = 'My picks';
      box.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      q(fixture, 'dashboard-watchlist-create')?.click();
      const request = http.expectOne(`${BASE}/api/v1/accounts/${ACCOUNT_ID}/watchlists`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ name: 'My picks' });
      request.flush(watchlistOf('new', 'My picks', []));
      fixture.detectChanges();

      expect(q(fixture, 'dashboard-watchlist-empty')).toBeNull();
      expect(q(fixture, 'watchlist-no-instruments')).not.toBeNull();
    });

    it('shows the alerts, with how far each stock is from its level using the latest quote', () => {
      setUp();
      api.set(`/accounts/${ACCOUNT_ID}/alerts`, [alertOn('a1', { symbol: 'TCS', threshold: 3465 })]);
      const fixture = create();

      expect(text(fixture, 'alert-threshold')).toContain('3,465.00');
      expect(text(fixture, 'alert-distance')).toBe('5.0% to go'); // TCS is at 3,300
    });

    it('shows only the first few alerts, and counts the rest', () => {
      setUp();
      api.set(`/accounts/${ACCOUNT_ID}/alerts`, Array.from({ length: 7 }, (_, i) => alertOn('a' + i, { threshold: 3400 + i })));
      const fixture = create();

      expect(all(fixture, 'alert-threshold')).toHaveLength(4);
      expect(text(fixture, 'alert-more')).toBe('+ 3 more');
    });

    it('opens the chart for a stock on the Watchlists page when one is picked from the search box', async () => {
      setUp();
      const fixture = create();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      (q(fixture, 'dashboard-alert-picker-input') as HTMLInputElement).dispatchEvent(new Event('focus'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      (q(fixture, 'picker-option-TCS') as HTMLElement).click();

      expect(navigate).toHaveBeenCalledWith(['/app/watchlists'], { queryParams: { alert: 'TCS' } });
    });

    it('opens a stock\'s chart when its symbol is clicked in the alert list', () => {
      setUp();
      api.set(`/accounts/${ACCOUNT_ID}/alerts`, [alertOn('a1')]);
      const fixture = create();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      q(fixture, 'alert-symbol')?.click();

      expect(navigate).toHaveBeenCalledWith(['/app/watchlists'], { queryParams: { alert: 'TCS' } });
    });

    it('stops polling the watchlists when the dashboard is left', () => {
      setUp();
      const fixture = create();
      const before = api.count('/watchlists');

      fixture.destroy();
      vi.advanceTimersByTime(120_000);

      expect(api.count('/watchlists')).toBe(before);
    });
  });

  describe('when it cannot get the data', () => {
    it('tells a user with no linked bank account to link one, and asks for nothing', () => {
      setUp(null);
      const fixture = create();

      expect(text(fixture, 'no-account')).toContain('No trading account yet');
      expect(api.requested).toHaveLength(0);
    });

    it('says so, with a retry, when the first load fails', () => {
      setUp();
      api.set(`/accounts/${ACCOUNT_ID}/balance`, { errorCode: 'X', message: 'down' }, 500);
      const fixture = create();

      expect(text(fixture, 'load-failed')).toContain('Could not load your dashboard');

      api.set(`/accounts/${ACCOUNT_ID}/balance`, { accountId: ACCOUNT_ID, cashBalance: 50000, currency: 'INR', asOf: '' });
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="load-failed"] button')!.click();
      fixture.detectChanges();
      settle(fixture);

      expect(text(fixture, 'portfolio-value')).toContain('79,500.00');
    });

    it('keeps the last good numbers on screen when a refresh fails, and says they may be stale', () => {
      setUp();
      const fixture = create();

      api.set(`/accounts/${ACCOUNT_ID}/portfolio`, { errorCode: 'X', message: 'down' }, 500);
      vi.advanceTimersByTime(60_000);
      fixture.detectChanges();
      settle(fixture);

      expect(text(fixture, 'refresh-failed')).toContain('may be out of date');
      expect(text(fixture, 'portfolio-value')).toContain('79,500.00');

      api.set(`/accounts/${ACCOUNT_ID}/portfolio`, PORTFOLIO);
      vi.advanceTimersByTime(60_000);
      fixture.detectChanges();
      settle(fixture);
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="refresh-failed"]')).toBeNull();
    });
  });
});
