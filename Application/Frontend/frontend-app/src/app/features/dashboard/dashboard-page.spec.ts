import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

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

describe('DashboardPage', () => {
  let http: HttpTestingController;
  let api: FakeApi;

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
      .get('/market/quotes', QUOTES);
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
    expect(titles).toEqual(expect.arrayContaining(['Order Flow', 'Recent Orders', 'Order Summary', 'Portfolio Allocation']));
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

    it('counts orders by status', () => {
      setUp();
      const fixture = create();

      expect(text(fixture, 'count-filled')).toBe('2');
      expect(text(fixture, 'count-working')).toBe('1');
      expect(text(fixture, 'count-rejected')).toBe('1');
      expect(text(fixture, 'count-cancelled')).toBe('1');
      expect(text(fixture, 'count-total')).toBe('5');
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
    expect(text(fixture, 'count-total')).toBe('0');
    expect(text(fixture, 'portfolio-value')).toContain('50,000.00');
  });

  it('limits the order flow to the chosen range', () => {
    setUp();
    const fixture = create();
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>('[data-testid="range-select"]')!;

    select.value = '7';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.componentInstance['rangeDays']()).toBe(7);
    expect(fixture.componentInstance['orderFlow']().categories).toHaveLength(7);
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
