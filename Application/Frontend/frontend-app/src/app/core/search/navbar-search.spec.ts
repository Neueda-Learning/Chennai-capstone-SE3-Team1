import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { provideApi } from '../../generated/trade-client';
import { FakeApi } from '../../testing/fake-api';
import { SessionStore } from '../auth/session.store';
import { NavbarSearch } from './navbar-search';

const QUOTES = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', price: 1300 },
  { symbol: 'TCS', name: 'Tata Consultancy Services', price: 3300 },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', price: null }
];
const ORDERS = [
  { orderId: 'ORD-aaa-111', accountId: 4, symbol: 'RELIANCE', side: 'BUY', quantity: 10, price: 1, executedPrice: 1, status: 'FILLED', createdOn: '2026-10-02T10:00:00' },
  { orderId: 'ORD-bbb-222', accountId: 4, symbol: 'TCS', side: 'SELL', quantity: 2, price: 1, executedPrice: null, status: 'NEW', createdOn: '2026-10-02T11:00:00' }
];

describe('NavbarSearch', () => {
  let http: HttpTestingController;
  let api: FakeApi;
  let fixture: ComponentFixture<NavbarSearch>;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  function setUp(accountId: number | null = 4): void {
    TestBed.configureTestingModule({
      imports: [NavbarSearch],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: 'http://trade.test' })]
    });
    if (accountId !== null) {
      TestBed.inject(SessionStore).signIn('token', accountId);
    }
    http = TestBed.inject(HttpTestingController);
    api = new FakeApi(http).get('/market/quotes', QUOTES).get('/accounts/4/orders', ORDERS);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(NavbarSearch);
    fixture.detectChanges();
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const input = () => root().querySelector<HTMLInputElement>('[data-testid="search-input"]')!;
  const hits = () => Array.from(root().querySelectorAll('[data-testid="search-hit"]')).map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');

  function type(text: string): void {
    input().dispatchEvent(new Event('focus'));
    input().value = text;
    input().dispatchEvent(new Event('input'));
    api.flush();
    fixture.detectChanges();
  }

  function key(name: string): void {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: name }));
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('loads nothing until the box is used', () => {
    setUp();
    expect(api.flush()).toBe(0);
  });

  it('finds tickers by symbol or company name, case-insensitively', () => {
    setUp();
    type('tata');

    expect(hits()).toEqual([
      expect.stringContaining('TCS'),
      expect.stringContaining('TATAMOTORS')
    ]);
    type('reli');
    expect(hits()).toHaveLength(2);
    expect(hits()[0]).toContain('Reliance Industries');
    expect(hits()[1]).toContain('ORD-aaa-111');
  });

  it('finds your orders by id or by symbol', () => {
    setUp();
    type('bbb');
    expect(hits()).toEqual([expect.stringContaining('ORD-bbb-222')]);
    expect(hits()[0]).toContain('SELL 2 TCS · NEW');

    type('reliance');
    expect(hits().some((h) => h.includes('ORD-aaa-111'))).toBe(true);
  });

  it('opens a picked ticker on the market page', () => {
    setUp();
    type('tcs');
    root().querySelector('[data-testid="search-hit"]')!.dispatchEvent(new Event('mousedown'));
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/orders'], { queryParams: { symbol: 'TCS' } });
    expect(input().value).toBe('');
  });

  it('opens a picked order in the blotter, filtered to it', () => {
    setUp();
    type('ord-aaa');
    root().querySelector('[data-testid="search-hit"]')!.dispatchEvent(new Event('mousedown'));

    expect(navigate).toHaveBeenCalledWith(['/blotter'], { queryParams: { q: 'ORD-aaa-111' } });
  });

  it('picks the highlighted result on Enter, moving with the arrow keys', () => {
    setUp();
    type('tata');
    key('ArrowDown');
    key('Enter');

    expect(navigate).toHaveBeenCalledWith(['/orders'], { queryParams: { symbol: 'TATAMOTORS' } });
  });

  it('wraps the highlight around the list', () => {
    setUp();
    type('tata');
    key('ArrowUp');
    key('Enter');

    expect(navigate).toHaveBeenCalledWith(['/orders'], { queryParams: { symbol: 'TATAMOTORS' } });
  });

  it('says so when nothing matches, and Enter then does nothing', () => {
    setUp();
    type('zzz');

    expect(root().querySelector('[data-testid="search-empty"]')?.textContent).toContain('zzz');
    key('Enter');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('closes and clears on Escape', () => {
    setUp();
    type('tcs');
    key('Escape');

    expect(root().querySelector('[data-testid="search-results"]')).toBeNull();
    expect(input().value).toBe('');
  });

  it('still finds tickers for a user with no trading account, and asks for no orders', () => {
    setUp(null);
    type('tcs');

    expect(hits()).toHaveLength(1);
    expect(api.count('/orders')).toBe(0);
  });

  it('survives the market endpoint failing', () => {
    setUp();
    api.set('/market/quotes', { errorCode: 'X', message: 'down' }, 500);
    type('tcs');

    expect(hits()).toEqual([expect.stringContaining('ORD-bbb-222')]);
    type('zzz');
    expect(root().querySelector('[data-testid="search-empty"]')).not.toBeNull();
  });
});
