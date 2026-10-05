import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { provideApi } from '../../generated/trade-client';
import { FakeApi } from '../../testing/fake-api';
import { PortfolioPage } from './portfolio-page';

const ACCOUNT_ID = 9;
const BASE = 'http://trade.test';

const QUOTES = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', price: 1400, bid: 1399, ask: 1401, currency: 'INR', change: 10, changePercent: 0.7, previousClose: 1390, marketState: 'REGULAR', stale: false, quoteAsOf: null, receivedAt: null },
  { symbol: 'TCS', name: 'Tata Consultancy Services', price: 3300, bid: 3299, ask: 3301, currency: 'INR', change: -20, changePercent: -0.6, previousClose: 3320, marketState: 'REGULAR', stale: false, quoteAsOf: null, receivedAt: null }
];

const PORTFOLIO = {
  accountId: ACCOUNT_ID,
  holdings: [
    { accountId: ACCOUNT_ID, symbol: 'RELIANCE', quantity: 10, averageCost: 1250, overallGains: 1500 },
    { accountId: ACCOUNT_ID, symbol: 'TCS', quantity: 5, averageCost: 3400, overallGains: -500 },
    { accountId: ACCOUNT_ID, symbol: 'INFY', quantity: 20, averageCost: 1400, overallGains: 1000 }
  ],
  positions: []
};

describe('PortfolioPage', () => {
  let http: HttpTestingController;
  let api: FakeApi;

  function setUp(accountId: number | null = ACCOUNT_ID): void {
    TestBed.configureTestingModule({
      imports: [PortfolioPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: BASE })]
    });
    if (accountId !== null) {
      TestBed.inject(SessionStore).signIn('token', accountId);
    }
    http = TestBed.inject(HttpTestingController);
    api = new FakeApi(http)
      .get(`/accounts/${ACCOUNT_ID}/balance`, { accountId: ACCOUNT_ID, cashBalance: 10000, currency: 'INR', asOf: '' })
      .get(`/accounts/${ACCOUNT_ID}/portfolio`, PORTFOLIO)
      .get('/market/quotes', QUOTES);
  }

  function create(): ComponentFixture<PortfolioPage> {
    const fixture = TestBed.createComponent(PortfolioPage);
    fixture.detectChanges();
    settle(fixture);
    return fixture;
  }

  function settle(fixture: ComponentFixture<PortfolioPage>): void {
    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    api.flush();
    fixture.detectChanges();
  }

  const root = (fixture: ComponentFixture<PortfolioPage>) => fixture.nativeElement as HTMLElement;
  const text = (fixture: ComponentFixture<PortfolioPage>, testId: string): string =>
    root(fixture).querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const rows = (fixture: ComponentFixture<PortfolioPage>, testId: string): string[] =>
    Array.from(root(fixture).querySelectorAll(`[data-testid="${testId}"]`)).map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    http?.verify();
    vi.useRealTimers();
  });

  it('should create', () => {
    setUp();
    expect(create().componentInstance).toBeTruthy();
  });

  it('lists every holding with quantity, cost, price, value and gain', () => {
    setUp();
    const fixture = create();

    const holdings = rows(fixture, 'holding-row');
    expect(holdings).toHaveLength(3);

    expect(holdings[0]).toContain('RELIANCE');
    expect(holdings[0]).toContain('Reliance Industries');
    expect(holdings[0]).toContain('₹1,250.00');
    expect(holdings[0]).toContain('₹1,400.00');
    expect(holdings[0]).toContain('₹14,000.00');
    expect(holdings[0]).toContain('+₹1,500.00');
    expect(holdings[0]).toContain('+12.00%');
    expect(holdings[0]).toContain('+₹100.00');

    expect(holdings[1]).toContain('TCS');
    expect(holdings[1]).toContain('-₹500.00');
    expect(holdings[1]).toContain('-2.94%');
  });

  it('totals the portfolio', () => {
    setUp();
    const fixture = create();

    expect(text(fixture, 'invested')).toContain('59,500.00');
    expect(text(fixture, 'cash')).toContain('10,000.00');
    expect(text(fixture, 'total-value')).toContain('69,500.00');
    expect(text(fixture, 'unrealised')).toContain('+₹2,000.00');
  });

  it('colours gains and losses', () => {
    setUp();
    const fixture = create();

    const gains = root(fixture).querySelectorAll('[data-testid="holding-row"] td.text-gain');
    const losses = root(fixture).querySelectorAll('[data-testid="holding-row"] td.text-loss');
    expect(gains.length).toBeGreaterThan(0);
    expect(losses.length).toBeGreaterThan(0);
  });

  it('marks a price estimated from the stored gain when there is no live quote', () => {
    setUp();
    const fixture = create();

    const infy = rows(fixture, 'holding-row')[2];
    expect(infy).toContain('INFY');
    expect(infy).toContain('est.');
    expect(infy).toContain('₹1,450.00');
  });

  it('links each holding to its ticker on the market page, to sell it from there', () => {
    setUp();
    const fixture = create();

    const link = root(fixture).querySelector<HTMLAnchorElement>('[data-testid="holding-row"] a')!;
    expect(link.getAttribute('href')).toBe('/orders?symbol=RELIANCE');
  });

  it('shows the intraday book separately, shorts included', () => {
    setUp();
    api.set(`/accounts/${ACCOUNT_ID}/portfolio`, {
      ...PORTFOLIO,
      holdings: [],
      positions: [{ accountId: ACCOUNT_ID, symbol: 'TCS', quantity: -2, averageCost: 3400, overallGains: 200 }]
    });
    const fixture = create();

    const positions = rows(fixture, 'position-row');
    expect(positions).toHaveLength(1);
    expect(positions[0]).toContain('-2');
    expect(positions[0]).toContain('+₹200.00');
  });

  it('does not show an intraday table when there are no positions', () => {
    setUp();
    const fixture = create();

    expect(root(fixture).querySelector('[data-testid="positions-table"]')).toBeNull();
  });

  it('shows an empty state with a way to buy when nothing is held', () => {
    setUp();
    api.set(`/accounts/${ACCOUNT_ID}/portfolio`, { accountId: ACCOUNT_ID, holdings: [], positions: [] });
    const fixture = create();

    expect(text(fixture, 'holdings-empty')).toContain('do not hold anything yet');
    expect(text(fixture, 'total-value')).toContain('10,000.00');
  });

  it('tells a user with no linked bank account to link one, and asks for nothing', () => {
    setUp(null);
    const fixture = create();

    expect(text(fixture, 'no-account')).toContain('No trading account yet');
    expect(api.requested).toHaveLength(0);
  });

  it('says so, with a retry, when it cannot load', () => {
    setUp();
    api.set(`/accounts/${ACCOUNT_ID}/portfolio`, { errorCode: 'X', message: 'down' }, 500);
    const fixture = create();
    expect(text(fixture, 'load-failed')).toContain('Could not load your portfolio');

    api.set(`/accounts/${ACCOUNT_ID}/portfolio`, PORTFOLIO);
    root(fixture).querySelector<HTMLButtonElement>('[data-testid="load-failed"] button')!.click();
    fixture.detectChanges();
    settle(fixture);

    expect(rows(fixture, 'holding-row')).toHaveLength(3);
  });

  it('refreshes by itself every minute, keeping the last data if a refresh fails', () => {
    setUp();
    const fixture = create();

    api.set(`/accounts/${ACCOUNT_ID}/balance`, { errorCode: 'X', message: 'down' }, 500);
    vi.advanceTimersByTime(60_000);
    fixture.detectChanges();
    settle(fixture);

    expect(text(fixture, 'refresh-failed')).toContain('may be out of date');
    expect(rows(fixture, 'holding-row')).toHaveLength(3);
  });
});
