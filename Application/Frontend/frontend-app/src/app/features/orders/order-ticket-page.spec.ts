import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { FormGroup } from '@angular/forms';
import { ActivatedRoute, ParamMap, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { provideApi } from '../../generated/trade-client';

import { OrderTicketPage, PRICE_PROTECTION } from './order-ticket-page';
import { SessionStore } from '../../core/auth/session.store';
import { NotificationStore } from '../../core/notifications/notification.store';
import { THEME_STORAGE } from '../../core/theme/theme.service';
import { PlotGeometry } from '../../core/charts/price-axis';
import { PriceChart } from './price-chart';

const ACCOUNT_ID = 42;
const BASE = 'http://trade.test';
const ORDERS_URL = `${BASE}/api/v1/orders`;
const ACCOUNT_URL = `${BASE}/api/v1/accounts/${ACCOUNT_ID}`;
const BALANCE_URL = `${ACCOUNT_URL}/balance`;
const PORTFOLIO_URL = `${ACCOUNT_URL}/portfolio`;
const WATCHLISTS_URL = `${ACCOUNT_URL}/watchlists`;
const ALERTS_URL = `${ACCOUNT_URL}/alerts`;
const QUOTES_URL = `${BASE}/api/v1/market/quotes`;

type TicketFixture = ComponentFixture<OrderTicketPage>;

function quote(overrides: Record<string, unknown>) {
  return {
    symbol: 'X',
    name: 'X Corp',
    price: 100,
    bid: 99.9,
    ask: 100.1,
    currency: 'INR',
    change: 1,
    changePercent: 1,
    previousClose: 99,
    marketState: 'REGULAR',
    stale: false,
    quoteAsOf: '2026-02-14T10:15:30Z',
    receivedAt: '2026-02-14T10:15:40Z',
    ...overrides
  };
}

const CANDLES = [
  { time: '2026-02-14T10:00:00Z', open: 100, high: 102, low: 99, close: 101, volume: null },
  { time: '2026-02-14T10:05:00Z', open: 101, high: 103, low: 100, close: 102, volume: null }
];

const QUOTES = [
  quote({ symbol: 'RELIANCE', name: 'Reliance Industries', price: 1300.1, bid: 1299.9, ask: 1300.3, change: 12.4, changePercent: 0.96 }),
  quote({ symbol: 'TCS', name: 'Tata Consultancy Services', price: 3300.5, bid: 3300.1, ask: 3300.9, change: -20, changePercent: -0.6 }),
  quote({ symbol: 'TATAMOTORS', name: 'Tata Motors', price: null, bid: null, ask: null, change: null, changePercent: null, marketState: null })
];

function balanceOf(overrides: Record<string, unknown> = {}) {
  return { accountId: ACCOUNT_ID, cashBalance: 42500.5, currency: 'INR', asOf: '2026-02-14T10:15:30Z', ...overrides };
}

function accountOf(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    accountId: 'IN45HDFC0000001234567',
    holderName: 'Aarav Mehta',
    bankName: 'HDFC Bank',
    cashBalance: 42500.5,
    status: 'ACTIVE',
    version: 0,
    lastUpdated: '2026-02-14T10:15:30Z',
    ...overrides
  };
}

function acceptedOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'ORD-9982',
    status: 'NEW',
    message: 'Order accepted',
    symbol: 'RELIANCE',
    side: 'BUY',
    quantity: 10,
    price: 1326.31,
    ...overrides
  };
}

describe('OrderTicketPage', () => {
  let http: HttpTestingController;

  let quotes: object[];
  let balance: object;
  let account: object;
  let portfolio: object;
  let failing: Set<string>;
  let alerts: object[];
  let candleRequests: string[];
  let alertsCreated: object[];

  function setUp(accountId: number | null = ACCOUNT_ID, symbolInUrl: string | null = null, params?: BehaviorSubject<ParamMap>): void {
    quotes = QUOTES;
    balance = balanceOf();
    account = accountOf();
    portfolio = {
      accountId: ACCOUNT_ID,
      holdings: [{ accountId: ACCOUNT_ID, symbol: 'RELIANCE', quantity: 7, averageCost: 1250, overallGains: 350 }],
      positions: []
    };
    failing = new Set();
    alerts = [];
    candleRequests = [];
    alertsCreated = [];

    TestBed.configureTestingModule({
      imports: [OrderTicketPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: BASE }),
        { provide: THEME_STORAGE, useValue: window.sessionStorage },
        ...(params !== undefined
          ? [{ provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } }]
          : symbolInUrl === null
          ? []
          : [{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: (name: string) => (name === 'symbol' ? symbolInUrl : null) } } } }])
      ]
    });

    if (accountId !== null) {
      TestBed.inject(SessionStore).signIn('token', accountId);
    }
    http = TestBed.inject(HttpTestingController);
  }

  function answer(request: TestRequest): void {
    const url = request.request.urlWithParams;
    const fail = (key: string) => failing.has(key);
    const refuse = () => request.flush({ errorCode: 'ACC-403', message: 'nope' }, { status: 403, statusText: 'Forbidden' });

    if (url === QUOTES_URL) {
      fail('quotes') ? refuse() : request.flush(quotes);
    } else if (url.startsWith(`${QUOTES_URL}/`) && url.includes('/candles')) {
      candleRequests.push(url);
      fail('candles') ? refuse() : request.flush(CANDLES);
    } else if (url === BALANCE_URL) {
      fail('balance') ? refuse() : request.flush(balance);
    } else if (url === ACCOUNT_URL) {
      fail('account') ? refuse() : request.flush(account);
    } else if (url === PORTFOLIO_URL) {
      fail('portfolio') ? refuse() : request.flush(portfolio);
    } else if (url === WATCHLISTS_URL) {
      request.flush([]);
    } else if (url === ALERTS_URL && request.request.method === 'GET') {
      fail('alerts') ? refuse() : request.flush(alerts);
    } else if (url === ALERTS_URL && request.request.method === 'POST') {
      const body = request.request.body as { symbol: string; threshold: number; direction: string };
      const created = { id: 'new-alert', state: 'ARMED', deliveryState: null, firedAt: null, firedPrice: null, createdAt: '2026-10-06T09:00:00Z', ...body };
      alertsCreated.push(body);
      alerts = [created, ...alerts];
      request.flush(created);
    } else {
      throw new Error(`unexpected request ${request.request.method} ${url}`);
    }
  }

  function settle(fixture: TicketFixture): void {
    for (let round = 0; round < 6; round++) {
      vi.advanceTimersByTime(1);
      fixture.detectChanges();
      const pending = http.match(() => true).filter((request) => !request.cancelled);
      if (pending.length === 0) {
        return;
      }
      pending.forEach(answer);
      fixture.detectChanges();
    }
  }

  function create(): TicketFixture {
    const fixture = TestBed.createComponent(OrderTicketPage);
    fixture.detectChanges();
    settle(fixture);
    return fixture;
  }

  function root(fixture: TicketFixture): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function textOf(fixture: TicketFixture, selector: string): string {
    const found = root(fixture).querySelector(selector);
    if (found === null) {
      throw new Error(`expected ${selector} to be rendered`);
    }
    return found.textContent ?? '';
  }

  function tickers(fixture: TicketFixture): HTMLButtonElement[] {
    return Array.from(root(fixture).querySelectorAll<HTMLButtonElement>('[data-testid="ticker"]'));
  }

  function pick(fixture: TicketFixture, symbol: string): void {
    tickers(fixture).find((button) => button.textContent?.includes(symbol))!.click();
    fixture.detectChanges();
    settle(fixture);
  }

  function click(fixture: TicketFixture, testId: string): void {
    root(fixture).querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click();
    fixture.detectChanges();
    settle(fixture);
  }

  function openChart(fixture: TicketFixture): void {
    click(fixture, 'open-chart');
  }

  function setSide(fixture: TicketFixture, side: 'buy' | 'sell'): void {
    root(fixture).querySelector<HTMLButtonElement>(`[data-testid="side-${side}"]`)!.click();
    fixture.detectChanges();
  }

  function setQuantity(fixture: TicketFixture, quantity: string): void {
    (fixture.componentInstance['form'] as FormGroup).controls['quantity'].setValue(quantity);
    fixture.detectChanges();
  }

  function submit(fixture: TicketFixture): void {
    (root(fixture).querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

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

  describe('the market', () => {
    it('lists every ticker with its latest price and move', () => {
      setUp();
      const fixture = create();

      const rows = tickers(fixture).map((row) => row.textContent ?? '');
      expect(rows).toHaveLength(3);
      expect(rows[0]).toContain('RELIANCE');
      expect(rows[0]).toContain('1,300.10');
      expect(rows[0]).toContain('+0.96%');
      expect(rows[1]).toContain('3,300.50');
      expect(rows[1]).toContain('-0.60%');
    });

    it('says a ticker is waiting for its first price instead of hiding it', () => {
      setUp();
      const fixture = create();

      const tata = tickers(fixture).find((row) => row.textContent?.includes('TATAMOTORS'))!;
      expect(tata.textContent).toContain('Waiting for price');
    });

    it('selects the first priced ticker and charts it', () => {
      setUp();
      const fixture = create();

      expect(textOf(fixture, '[data-testid="selected-symbol"]')).toContain('RELIANCE');
      expect(textOf(fixture, '[data-testid="current-price"]')).toContain('1,300.10');
      expect(candleRequests.some((url) => url.includes('/RELIANCE/candles?interval=5m&range=1d'))).toBe(true);
      expect(tickers(fixture)[0].classList.contains('active')).toBe(true);
    });

    it('selects the ticker named in the URL instead, when there is one', () => {
      setUp(ACCOUNT_ID, 'TCS');
      const fixture = create();

      expect(textOf(fixture, '[data-testid="selected-symbol"]')).toContain('TCS');
    });

    it('follows ?symbol= in the URL even once the page is open (the navbar search does this)', () => {
      const params = new BehaviorSubject(convertToParamMap({}));
      setUp(ACCOUNT_ID, null, params);
      const fixture = create();
      expect(textOf(fixture, '[data-testid="selected-symbol"]')).toContain('RELIANCE');

      params.next(convertToParamMap({ symbol: 'TCS' }));
      fixture.detectChanges();
      settle(fixture);

      expect(textOf(fixture, '[data-testid="selected-symbol"]')).toContain('TCS');
    });

    describe('a link from the assistant (?symbol=&side=&quantity=)', () => {
      const side = (fixture: TicketFixture) => (fixture.componentInstance as unknown as { side: () => string }).side();
      const quantityBox = (fixture: TicketFixture) => (root(fixture).querySelector('#quantity') as HTMLInputElement).value;

      it('fills in the side and quantity once the page is open, and places nothing', () => {
        const params = new BehaviorSubject(convertToParamMap({}));
        setUp(ACCOUNT_ID, null, params);
        const fixture = create();

        params.next(convertToParamMap({ symbol: 'TCS', side: 'SELL', quantity: '20' }));
        fixture.detectChanges();
        settle(fixture);

        expect(textOf(fixture, '[data-testid="selected-symbol"]')).toContain('TCS');
        expect(side(fixture)).toBe('SELL');
        expect(quantityBox(fixture)).toBe('20');
        http.expectNone(ORDERS_URL);
      });

      it('fills them in when the page is opened straight from the link', () => {
        setUp(ACCOUNT_ID, null, new BehaviorSubject(convertToParamMap({ symbol: 'TCS', side: 'SELL', quantity: '3' })));
        const fixture = create();

        expect(side(fixture)).toBe('SELL');
        expect(quantityBox(fixture)).toBe('3');
      });

      it('ignores a side or a quantity that is not valid', () => {
        const params = new BehaviorSubject(convertToParamMap({}));
        setUp(ACCOUNT_ID, null, params);
        const fixture = create();

        params.next(convertToParamMap({ symbol: 'TCS', side: 'HOLD', quantity: '-5' }));
        fixture.detectChanges();
        settle(fixture);

        expect(side(fixture)).toBe('BUY');
        expect(quantityBox(fixture)).toBe('');
      });

      it('ignores a fractional, zero or absurdly large quantity', () => {
        for (const quantity of ['2.5', '0', '12345678', 'abc', '']) {
          const params = new BehaviorSubject(convertToParamMap({}));
          TestBed.resetTestingModule();
          setUp(ACCOUNT_ID, null, params);
          const fixture = create();

          params.next(convertToParamMap({ symbol: 'TCS', quantity }));
          fixture.detectChanges();
          settle(fixture);

          expect(quantityBox(fixture), `quantity=${quantity}`).toBe('');
        }
      });
    });

    it('shows another ticker and its history when it is clicked', () => {
      setUp();
      const fixture = create();

      pick(fixture, 'TCS');

      expect(textOf(fixture, '[data-testid="selected-symbol"]')).toContain('TCS');
      expect(textOf(fixture, '[data-testid="current-price"]')).toContain('3,300.50');
      expect(candleRequests.some((url) => url.includes('/TCS/candles'))).toBe(true);
    });

    it('says so when the chart data cannot be loaded', () => {
      setUp();
      failing.add('candles');
      const fixture = create();
      openChart(fixture);

      expect(textOf(fixture, '[data-testid="history-failed"]')).toContain('Could not load the chart data');
    });

    it('says why a chart is empty, differently for short candles and daily ones', () => {
      setUp();
      const fixture = create();
      openChart(fixture);
      const empty = () => root(fixture).querySelector('[data-testid="history-empty"]')?.textContent?.replace(/\s+/g, ' ');
      expect(empty()).toBeUndefined();

      const original = CANDLES.splice(0, CANDLES.length);
      try {
        click(fixture, 'range-1h');
        expect(empty()).toContain('fill in as the minute-by-minute quotes arrive');
        click(fixture, 'range-1y');
        expect(empty()).toContain('No daily history is available');
      } finally {
        CANDLES.push(...original);
      }
    });

    it('says so when the prices cannot be loaded', () => {
      setUp();
      failing.add('quotes');
      const fixture = create();

      expect(textOf(fixture, '[data-testid="quotes-failed"]')).toContain('Could not load market prices');
    });

    it('refreshes the prices on a timer, without another click', () => {
      setUp();
      const fixture = create();

      quotes = [quote({ symbol: 'RELIANCE', name: 'Reliance Industries', price: 1310, bid: 1309.9, ask: 1310.1 }), ...QUOTES.slice(1)];
      vi.advanceTimersByTime(30_000);
      fixture.detectChanges();
      settle(fixture);

      expect(textOf(fixture, '[data-testid="current-price"]')).toContain('1,310.00');
    });

    it('marks a delayed quote', () => {
      setUp();
      quotes = [quote({ symbol: 'RELIANCE', name: 'Reliance Industries', stale: true }), ...QUOTES.slice(1)];
      const fixture = create();

      expect(textOf(fixture, '[data-testid="stale-badge"]')).toContain('Delayed');
    });
  });

  describe('the chart controls', () => {
    const labels = (fixture: TicketFixture, prefix: string) =>
      Array.from(root(fixture).querySelectorAll(`[data-testid^="${prefix}"]`)).map((b) => b.textContent?.trim());

    it('starts on 5-minute candles over one day', () => {
      setUp();
      const fixture = create();
      openChart(fixture);

      expect(root(fixture).querySelector('[data-testid="range-1d"]')?.classList.contains('active')).toBe(true);
      expect(root(fixture).querySelector('[data-testid="interval-5m"]')?.classList.contains('active')).toBe(true);
      expect(candleRequests.some((url) => url.includes('interval=5m&range=1d'))).toBe(true);
    });

    it('offers short ranges, daily ranges, and finer candles than just 1H and 8H', () => {
      setUp();
      const fixture = create();
      openChart(fixture);

      expect(labels(fixture, 'range-')).toEqual(['1H', '3H', '8H', '1D', '3D', '1W', '1M', '3M', '6M', 'YTD', '1Y']);
      expect(labels(fixture, 'interval-')).toEqual(['1m', '5m', '15m', '30m', '1h']);
    });

    it('only offers candle sizes that fit the chosen range', () => {
      setUp();
      const fixture = create();
      openChart(fixture);

      click(fixture, 'range-1w');
      expect(labels(fixture, 'interval-')).toEqual(['15m', '30m', '1h']);
      click(fixture, 'range-ytd');
      expect(labels(fixture, 'interval-')).toEqual(['1D', '1W', '1M']);
    });

    it('asks the API for the candle size and range chosen', () => {
      setUp();
      const fixture = create();
      openChart(fixture);
      candleRequests.length = 0;

      click(fixture, 'interval-15m');
      click(fixture, 'range-3mo');

      expect(candleRequests.some((url) => url.includes('interval=15m&range=1d'))).toBe(true);
      expect(candleRequests.some((url) => url.includes('interval=1d&range=3mo'))).toBe(true);
    });

    it('keeps the candle size when it still fits a new range, else takes that range default', () => {
      setUp();
      const fixture = create();
      openChart(fixture);

      click(fixture, 'interval-15m');
      click(fixture, 'range-3d');
      expect(root(fixture).querySelector('[data-testid="interval-15m"]')?.classList.contains('active')).toBe(true);

      click(fixture, 'range-1y');
      expect(root(fixture).querySelector('[data-testid="interval-1w"]')?.classList.contains('active')).toBe(true);
    });

    it('re-reads the candles of the next ticker, with the same setup', () => {
      setUp();
      const fixture = create();
      openChart(fixture);
      click(fixture, 'interval-15m');
      candleRequests.length = 0;

      pick(fixture, 'TCS');

      expect(candleRequests.some((url) => url.includes('/TCS/candles?interval=15m&range=1d'))).toBe(true);
    });

    it('switches between candles and a line', () => {
      setUp();
      const fixture = create();
      openChart(fixture);
      expect(root(fixture).querySelector('[data-testid="style-candles"]')?.classList.contains('active')).toBe(true);

      click(fixture, 'style-line');

      expect(root(fixture).querySelector('[data-testid="style-line"]')?.classList.contains('active')).toBe(true);
      expect(root(fixture).querySelector('[data-testid="style-candles"]')?.classList.contains('active')).toBe(false);
    });

    it('lists every indicator, and turning one on or off is a checkbox', () => {
      setUp();
      const fixture = create();
      openChart(fixture);
      const box = (id: string) => root(fixture).querySelector<HTMLInputElement>(`[data-testid="indicator-${id}"]`)!;

      expect(Array.from(root(fixture).querySelectorAll('.indicator-item')).map((e) => e.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
        'SMA 20', 'SMA 50', 'EMA 20', 'Bollinger', 'Volumedaily candles', 'RSI 14', 'MACD'
      ]);
      expect(box('sma20').checked).toBe(true);
      expect(box('macd').checked).toBe(false);

      box('macd').click();
      box('bollinger').click();
      fixture.detectChanges();
      expect(box('macd').checked).toBe(true);
      expect(textOf(fixture, '[data-testid="indicator-count"]')).toBe('3');

      box('sma20').click();
      fixture.detectChanges();
      expect(box('sma20').checked).toBe(false);
      expect(textOf(fixture, '[data-testid="indicator-count"]')).toBe('2');
    });

    it('volume is unavailable for short candles and available for daily ones', () => {
      setUp();
      const fixture = create();
      openChart(fixture);
      const volume = () => root(fixture).querySelector<HTMLInputElement>('[data-testid="indicator-volume"]')!;

      expect(volume().disabled).toBe(true);
      click(fixture, 'range-ytd');
      expect(volume().disabled).toBe(false);
    });

    it('draws a pane for each pane-style indicator that is on', () => {
      setUp();
      const fixture = create();
      openChart(fixture);
      const shown = (pane: string) => !root(fixture).querySelector<HTMLElement>(`[data-testid="pane-${pane}"]`)!.hidden;

      expect([shown('volume'), shown('rsi'), shown('macd')]).toEqual([false, false, false]);

      click(fixture, 'range-ytd');
      for (const id of ['volume', 'rsi', 'macd']) {
        root(fixture).querySelector<HTMLInputElement>(`[data-testid="indicator-${id}"]`)!.click();
      }
      fixture.detectChanges();

      expect([shown('volume'), shown('rsi'), shown('macd')]).toEqual([true, true, true]);
    });

    it('remembers the setup for the next visit', () => {
      setUp();
      const fixture = create();
      openChart(fixture);
      click(fixture, 'range-3mo');
      click(fixture, 'style-line');
      root(fixture).querySelector<HTMLInputElement>('[data-testid="indicator-rsi"]')!.click();
      fixture.detectChanges();
      TestBed.tick();

      expect(JSON.parse(localStorage.getItem('trading-ui.chart')!)).toEqual({
        range: '3mo', interval: '1d', style: 'line', indicators: ['sma20', 'rsi']
      });
    });

    it('restores a saved setup, and ignores anything in it that is not valid', () => {
      localStorage.setItem('trading-ui.chart', JSON.stringify({ range: '1w', interval: '1m', style: 'line', indicators: ['macd', 'bogus'] }));
      setUp();
      const fixture = create();
      openChart(fixture);

      expect(root(fixture).querySelector('[data-testid="range-1w"]')?.classList.contains('active')).toBe(true);
      expect(root(fixture).querySelector('[data-testid="interval-30m"]')?.classList.contains('active')).toBe(true);
      expect(root(fixture).querySelector('[data-testid="style-line"]')?.classList.contains('active')).toBe(true);
      expect(root(fixture).querySelector<HTMLInputElement>('[data-testid="indicator-macd"]')!.checked).toBe(true);
      expect(root(fixture).querySelector('[data-testid="indicator-bogus"]')).toBeNull();
    });

    it('survives a corrupt saved setup', () => {
      localStorage.setItem('trading-ui.chart', '{not json');
      setUp();
      const fixture = create();
      openChart(fixture);

      expect(root(fixture).querySelector('[data-testid="range-1d"]')?.classList.contains('active')).toBe(true);
    });

    it('resets to the default setup', () => {
      setUp();
      const fixture = create();
      openChart(fixture);
      click(fixture, 'range-ytd');
      click(fixture, 'style-line');

      root(fixture).querySelector<HTMLButtonElement>('[data-testid="chart-reset"]')!.click();
      fixture.detectChanges();
      settle(fixture);

      expect(root(fixture).querySelector('[data-testid="range-1d"]')?.classList.contains('active')).toBe(true);
      expect(root(fixture).querySelector('[data-testid="style-candles"]')?.classList.contains('active')).toBe(true);
    });
  });

  describe('the trend dialog', () => {
    it('stays shut until asked, then shows the chart for the selected ticker', () => {
      setUp();
      const fixture = create();

      expect(root(fixture).querySelector('[data-testid="chart-dialog"]')).toBeNull();

      openChart(fixture);

      expect(textOf(fixture, '[data-testid="chart-dialog-title"]')).toContain('RELIANCE');
      expect(root(fixture).querySelector('[data-testid="chart-toolbar"]')).not.toBeNull();
    });

    it('closes again from its close button', () => {
      setUp();
      const fixture = create();
      openChart(fixture);

      click(fixture, 'close-chart');

      expect(root(fixture).querySelector('[data-testid="chart-dialog"]')).toBeNull();
    });

    it('opens straight from a ticker row, selecting that ticker', () => {
      setUp();
      const fixture = create();

      const buttons = Array.from(
        root(fixture).querySelectorAll<HTMLButtonElement>('[data-testid="ticker-chart"]')
      );
      buttons[1].click();
      fixture.detectChanges();
      settle(fixture);

      expect(textOf(fixture, '[data-testid="selected-symbol"]')).toContain('TCS');
      expect(textOf(fixture, '[data-testid="chart-dialog-title"]')).toContain('TCS');
    });
  });

  describe('the ticket', () => {
    it('has no price field, no order type and no symbol box: orders go in at the current price', () => {
      setUp();
      const fixture = create();

      expect(root(fixture).querySelector('input#price')).toBeNull();
      expect(root(fixture).querySelector('input[name="orderType"]')).toBeNull();
      expect(root(fixture).querySelector('select#symbol')).toBeNull();
      expect(root(fixture).textContent).not.toContain('Limit');
    });

    it('shows the current price of the selected ticker', () => {
      setUp();
      const fixture = create();

      expect(textOf(fixture, '[data-testid="ticket-price"]')).toContain('1,300.10');
    });

    it('defaults to Buy and switches to Sell on click', () => {
      setUp();
      const fixture = create();
      const buy = root(fixture).querySelector<HTMLButtonElement>('[data-testid="side-buy"]')!;
      const sell = root(fixture).querySelector<HTMLButtonElement>('[data-testid="side-sell"]')!;
      expect(buy.classList.contains('btn-custom-primary')).toBe(true);

      sell.click();
      fixture.detectChanges();

      expect(buy.classList.contains('btn-custom-outline-primary')).toBe(true);
      expect(sell.classList.contains('btn-custom-danger')).toBe(true);
    });

    it('shows the units available only when selling, taken from what the account holds', () => {
      setUp();
      const fixture = create();
      expect(root(fixture).querySelector('[data-testid="units-available"]')).toBeNull();

      setSide(fixture, 'sell');

      expect(textOf(fixture, '[data-testid="units-available"]')).toContain('7');
    });

    it('shows zero units for a ticker the account does not hold', () => {
      setUp();
      const fixture = create();
      pick(fixture, 'TCS');
      setSide(fixture, 'sell');

      expect(textOf(fixture, '[data-testid="units-available"]').trim()).toBe('0');
    });

    it('fills in everything held when Sell all is clicked', () => {
      setUp();
      const fixture = create();
      setSide(fixture, 'sell');

      root(fixture).querySelector<HTMLButtonElement>('[data-testid="sell-all"]')!.click();
      fixture.detectChanges();

      expect((root(fixture).querySelector('#quantity') as HTMLInputElement).value).toBe('7');
    });

    it('estimates the cost from the current price', () => {
      setUp();
      const fixture = create();
      setQuantity(fixture, '10');

      expect(textOf(fixture, '[data-testid="estimated-total"]')).toContain('13,001.00');
    });
  });

  describe('placing an order', () => {
    it('buys at the market: the quantity, the ticker and a limit just above the ask, never a typed price', () => {
      setUp();
      const fixture = create();
      setQuantity(fixture, '10');

      submit(fixture);

      const request = http.expectOne(ORDERS_URL);
      expect(request.request.method).toBe('POST');
      expect(request.request.body.accountId).toBe(ACCOUNT_ID);
      expect(request.request.body.symbol).toBe('RELIANCE');
      expect(request.request.body.side).toBe('BUY');
      expect(request.request.body.quantity).toBe(10);
      expect(request.request.body.price).toBe(1326.31);
      expect(request.request.body.idempotencyKey).toBeTruthy();

      request.flush(acceptedOrder());
      fixture.detectChanges();
      settle(fixture);

      const outcome = textOf(fixture, '[data-testid="outcome-accepted"]');
      expect(outcome).toContain('ORD-9982');
      expect(outcome).toContain('NEW');
      expect(outcome).toContain('current market price');
      expect(outcome).not.toContain('1,326.31');
    });

    it('logs only the status and what happened on accept, nothing sensitive', () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      try {
        setUp();
        const fixture = create();
        setQuantity(fixture, '10');
        submit(fixture);

        http.expectOne(ORDERS_URL).flush(acceptedOrder());
        fixture.detectChanges();
        settle(fixture);

        expect(info).toHaveBeenCalledTimes(1);
        expect(info).toHaveBeenCalledWith('[order] 200 BOUGHT [RELIANCE, 10]');
      } finally {
        info.mockRestore();
      }
    });

    it('logs only the status and the message on refusal', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        setUp();
        const fixture = create();
        setQuantity(fixture, '2');
        submit(fixture);

        http
          .expectOne(ORDERS_URL)
          .flush({ errorCode: 'ORD-400', message: 'Insufficient funds in the account.' }, { status: 400, statusText: 'Bad Request' });
        fixture.detectChanges();
        settle(fixture);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith('[order] 400 Insufficient funds in the account.');
      } finally {
        warn.mockRestore();
      }
    });

    it('sells at the market: a limit just below the bid', () => {
      setUp();
      const fixture = create();
      setSide(fixture, 'sell');
      setQuantity(fixture, '3');

      submit(fixture);

      const request = http.expectOne(ORDERS_URL);
      expect(request.request.body.side).toBe('SELL');
      expect(request.request.body.quantity).toBe(3);
      expect(request.request.body.price).toBe(1273.9);
      request.flush(acceptedOrder({ side: 'SELL' }));
      fixture.detectChanges();
      settle(fixture);
    });

    it('protects within the stated percentage', () => {
      expect(PRICE_PROTECTION).toBe(0.02);
    });

    it('trades the ticker that is selected, not the first one', () => {
      setUp();
      const fixture = create();
      pick(fixture, 'TCS');
      setQuantity(fixture, '1');

      submit(fixture);

      const request = http.expectOne(ORDERS_URL);
      expect(request.request.body.symbol).toBe('TCS');
      request.flush(acceptedOrder({ symbol: 'TCS' }));
      fixture.detectChanges();
      settle(fixture);
    });

    it('refreshes the wallet, the holdings and the notifications once the order is accepted', () => {
      setUp();
      const fixture = create();
      const refresh = vi.spyOn(TestBed.inject(NotificationStore), 'refresh');
      setQuantity(fixture, '1');
      submit(fixture);
      http.expectOne(ORDERS_URL).flush(acceptedOrder());

      balance = balanceOf({ cashBalance: 41000 });
      fixture.detectChanges();
      settle(fixture);

      expect(refresh).toHaveBeenCalled();
      expect(textOf(fixture, '[data-testid="balance"]')).toContain('41,000.00');
    });

    it('reloads the cash and units held when the fill notification arrives, not just when the order is accepted', () => {
      setUp();
      const fixture = create();
      setQuantity(fixture, '1');
      submit(fixture);
      http.expectOne(ORDERS_URL).flush(acceptedOrder());
      fixture.detectChanges();
      settle(fixture);
      expect(textOf(fixture, '[data-testid="balance"]')).toContain('42,500.50');

      balance = balanceOf({ cashBalance: 41200 });
      TestBed.inject(NotificationStore)['changesSignal'].update((n: number) => n + 1);
      fixture.detectChanges();
      settle(fixture);

      expect(textOf(fixture, '[data-testid="balance"]')).toContain('41,200.00');
    });

    it('clears the quantity after an order goes through, so it cannot be sent twice by accident', () => {
      setUp();
      const fixture = create();
      setQuantity(fixture, '2');
      submit(fixture);
      http.expectOne(ORDERS_URL).flush(acceptedOrder());
      fixture.detectChanges();
      settle(fixture);

      expect((root(fixture).querySelector('#quantity') as HTMLInputElement).value).toBe('');
    });

    it('shows an order that comes back FILLED as a finished one', () => {
      setUp();
      const fixture = create();
      setQuantity(fixture, '2');
      submit(fixture);
      http.expectOne(ORDERS_URL).flush(acceptedOrder({ status: 'FILLED' }));
      fixture.detectChanges();
      settle(fixture);

      const outcome = textOf(fixture, '[data-testid="outcome-accepted"]');
      expect(outcome).toContain('FILLED');
      expect(outcome).not.toContain('Working.');
    });

    it('blocks a fractional quantity before it reaches the wire', () => {
      setUp();
      const fixture = create();
      setQuantity(fixture, '1.5');
      submit(fixture);

      http.expectNone(ORDERS_URL);
      expect(textOf(fixture, '.invalid-custom')).toContain('whole number of units');
    });

    it('blocks a quantity of zero before it reaches the wire', () => {
      setUp();
      const fixture = create();
      setQuantity(fixture, '0');
      submit(fixture);

      http.expectNone(ORDERS_URL);
      expect(textOf(fixture, '.invalid-custom')).toContain('greater than zero');
    });

    it('blocks an empty quantity before it reaches the wire', () => {
      setUp();
      const fixture = create();
      submit(fixture);

      http.expectNone(ORDERS_URL);
      expect(textOf(fixture, '.invalid-custom')).toContain('how many units');
    });

    it('blocks selling more than is held', () => {
      setUp();
      const fixture = create();
      setSide(fixture, 'sell');
      setQuantity(fixture, '8');
      submit(fixture);

      http.expectNone(ORDERS_URL);
      expect(textOf(fixture, '[data-testid="ticket-error"]')).toContain('more units than you hold');
    });

    it('allows selling exactly what is held', () => {
      setUp();
      const fixture = create();
      setSide(fixture, 'sell');
      setQuantity(fixture, '7');
      submit(fixture);

      http.expectOne(ORDERS_URL).flush(acceptedOrder({ side: 'SELL', quantity: 7 }));
      fixture.detectChanges();
      settle(fixture);
    });

    it('blocks a buy the wallet cannot cover, counting the protection', () => {
      setUp();
      balance = balanceOf({ cashBalance: 13000 });
      const fixture = create();
      setQuantity(fixture, '10');
      submit(fixture);

      http.expectNone(ORDERS_URL);
      expect(textOf(fixture, '[data-testid="ticket-error"]')).toContain('Not enough cash');
    });

    it('will not trade a ticker that has no price yet', () => {
      setUp();
      const fixture = create();
      pick(fixture, 'TATAMOTORS');
      setQuantity(fixture, '1');
      submit(fixture);

      http.expectNone(ORDERS_URL);
      expect(textOf(fixture, '[data-testid="ticket-error"]')).toContain('no current price');
    });

    it('shows the mapped message for a business-rule rejection', () => {
      setUp();
      const fixture = create();
      setQuantity(fixture, '2');
      submit(fixture);

      http
        .expectOne(ORDERS_URL)
        .flush({ errorCode: 'ORD-400', message: 'Insufficient funds in the account.' }, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();
      settle(fixture);

      expect(textOf(fixture, '[data-testid="outcome-refused"]')).toContain('Insufficient funds');
      expect(textOf(fixture, '[data-testid="outcome-refused"]')).toContain('Order not placed');
    });

    it('falls back to a readable message when the API sends no envelope', () => {
      setUp();
      const fixture = create();
      setQuantity(fixture, '2');
      submit(fixture);

      http.expectOne(ORDERS_URL).flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      settle(fixture);

      expect(textOf(fixture, '[data-testid="outcome-refused"]')).toContain('could not be placed');
    });

    it('does not submit when the session has no trading account', () => {
      setUp(null);
      const fixture = create();
      setQuantity(fixture, '2');
      submit(fixture);

      http.expectNone(ORDERS_URL);
      expect(textOf(fixture, '[data-testid="outcome-refused"]')).toContain('No trading account is linked');
    });
  });

  describe('the wallet card', () => {
    it('shows the balance the API returned, not a constant', () => {
      setUp();
      balance = balanceOf({ cashBalance: 1234.56 });
      const fixture = create();

      const text = textOf(fixture, '[data-testid="balance"]');
      expect(text).toContain('1,234.56');
      expect(text).not.toContain('42,500');
    });

    it('says the balance is unknown when it will not load', () => {
      setUp();
      failing.add('balance');
      const fixture = create();

      expect(textOf(fixture, '[data-testid="balance"]')).toContain('Could not load balance');
    });

    it('does not ask for a balance, account or portfolio the session has no account for', () => {
      setUp(null);
      create();

      http.expectNone(BALANCE_URL);
      http.expectNone(ACCOUNT_URL);
      http.expectNone(PORTFOLIO_URL);
    });

    it('leads with the bank name, with the holder and business number as context', () => {
      setUp();
      const fixture = create();

      expect(textOf(fixture, '[data-testid="bank-name"]')).toBe('HDFC Bank');
      const text = textOf(fixture, '[data-testid="account-id"]');
      expect(text).toContain('Aarav Mehta');
      expect(text).toContain('IN45HDFC0000001234567');
      expect(text).not.toContain(String(ACCOUNT_ID));
    });

    it('says no bank linked when the user has not linked one', () => {
      setUp();
      account = accountOf({ accountId: null, bankName: null });
      const fixture = create();

      expect(textOf(fixture, '[data-testid="bank-name"]')).toBe('No bank linked');
      expect(textOf(fixture, '[data-testid="account-id"]')).not.toContain('null');
    });

    it('says the account is not linked when the session has no account claim', () => {
      setUp(null);
      const fixture = create();

      expect(textOf(fixture, '[data-testid="account-id"]')).toContain('Not linked');
    });

    it('reports an account it could not load, rather than showing a blank', () => {
      setUp();
      failing.add('account');
      const fixture = create();

      expect(textOf(fixture, '[data-testid="account-id"]')).toContain('Could not load account');
    });

    it('does not offer the account as a field', () => {
      setUp();
      const fixture = create();

      expect(root(fixture).querySelector('input[name="accountId"]')).toBeNull();
      expect(root(fixture).querySelector('select[name="accountId"]')).toBeNull();
    });
  });

  describe('price alerts', () => {
    const GEOMETRY: PlotGeometry = { translateX: 60, translateY: 10, gridWidth: 500, gridHeight: 300, min: 100, max: 200 };

    function alertOn(symbol: string, overrides: Record<string, unknown> = {}) {
      return {
        id: `a-${symbol}-${Math.round(Math.random() * 1e6)}`,
        symbol,
        threshold: 1400,
        direction: 'ABOVE',
        state: 'ARMED',
        deliveryState: null,
        firedAt: null,
        firedPrice: null,
        createdAt: '2026-10-06T09:00:00Z',
        ...overrides
      };
    }

    const composer = (fixture: TicketFixture) => root(fixture).querySelector<HTMLElement>('[data-testid="alert-composer"]');
    const markerOn = (fixture: TicketFixture) =>
      root(fixture).querySelector('[data-testid="marker-toggle"]')?.getAttribute('aria-pressed') === 'true';

    beforeEach(() => {
      vi.spyOn(PriceChart.prototype as unknown as { geometry: () => PlotGeometry | null }, 'geometry').mockReturnValue(GEOMETRY);
    });

    afterEach(() => vi.restoreAllMocks());

    it('offers an Alert button for the selected ticker, counting only its armed alerts', () => {
      setUp();
      alerts = [alertOn('RELIANCE'), alertOn('RELIANCE', { state: 'FIRED' }), alertOn('TCS')];
      const fixture = create();

      expect(textOf(fixture, '[data-testid="open-alert"]')).toContain('Alert');
      expect(textOf(fixture, '[data-testid="alert-count"]')).toBe('1');

      pick(fixture, 'TCS');
      expect(textOf(fixture, '[data-testid="alert-count"]')).toBe('1');
    });

    it('shows no count when the ticker has no armed alerts', () => {
      setUp();
      alerts = [alertOn('TCS')];
      const fixture = create();

      expect(root(fixture).querySelector('[data-testid="alert-count"]')).toBeNull();
    });

    it('opens the chart already in marker mode when Alert is pressed, with the panel to confirm in', () => {
      setUp();
      const fixture = create();

      click(fixture, 'open-alert');

      expect(root(fixture).querySelector('[data-testid="chart-dialog"]')).not.toBeNull();
      expect(composer(fixture)).not.toBeNull();
      expect(markerOn(fixture)).toBe(true);
      expect(textOf(fixture, '[data-testid="marker-hint"]')).toContain('Click the chart');
    });

    it('puts the alert panel to the right of the chart in the dialog, not underneath', () => {
      setUp();
      const fixture = create();

      click(fixture, 'open-alert');

      const split = root(fixture).querySelector('.chart-split') as HTMLElement;
      const panel = root(fixture).querySelector('[data-testid="alert-panel"]') as HTMLElement;
      expect(panel.parentElement).toBe(split);
      expect(split.children[0].querySelector('tui-price-chart')).not.toBeNull();
      expect(split.children[1]).toBe(panel);
    });

    it('opens the plain trend chart, with markers off, when Trend is pressed', () => {
      setUp();
      const fixture = create();

      openChart(fixture);

      expect(composer(fixture)).not.toBeNull();
      expect(markerOn(fixture)).toBe(false);
    });

    it('turns a click on the chart into a marker the panel offers to confirm, then sets the alert', () => {
      setUp();
      const fixture = create();
      click(fixture, 'open-alert');

      root(fixture).querySelector<HTMLElement>('[data-testid="chart-surface"]')!.dispatchEvent(
        new MouseEvent('click', { clientX: 200, clientY: 85, bubbles: true }) // a quarter down: 175
      );
      fixture.detectChanges();
      expect((root(fixture).querySelector('[data-testid="composer-price"]') as HTMLInputElement).value).toBe('175.00');

      click(fixture, 'composer-confirm');

      // 175 is far below RELIANCE's price (about 1,300), so this alert waits for a fall.
      expect(alertsCreated).toEqual([{ symbol: 'RELIANCE', threshold: 175, direction: 'BELOW' }]);
      expect(textOf(fixture, '[data-testid="composer-done"]')).toContain('RELIANCE');
      expect(root(fixture).querySelector('[data-testid="composer-form"]')).toBeNull();
      expect(textOf(fixture, '[data-testid="alert-count"]')).toBe('1');
    });

    it('drops a marker that was being placed when another ticker is picked, and when the chart is closed', () => {
      setUp();
      const fixture = create();
      click(fixture, 'open-alert');
      root(fixture).querySelector<HTMLElement>('[data-testid="chart-surface"]')!.dispatchEvent(
        new MouseEvent('click', { clientX: 200, clientY: 85, bubbles: true })
      );
      fixture.detectChanges();
      expect(root(fixture).querySelector('[data-testid="composer-form"]')).not.toBeNull();

      click(fixture, 'close-chart');
      openChart(fixture);

      expect(root(fixture).querySelector('[data-testid="composer-form"]')).toBeNull();
      expect(markerOn(fixture)).toBe(false);
    });

    it('lists the ticker\'s existing alerts in the chart panel, and no other ticker\'s', () => {
      setUp();
      alerts = [alertOn('RELIANCE', { id: 'mine' }), alertOn('TCS', { id: 'theirs' })];
      const fixture = create();

      openChart(fixture);

      expect(root(fixture).querySelector('[data-testid="composer-alert-mine"]')).not.toBeNull();
      expect(root(fixture).querySelector('[data-testid="composer-alert-theirs"]')).toBeNull();
    });
  });
});
