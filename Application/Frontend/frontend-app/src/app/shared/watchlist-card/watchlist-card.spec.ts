import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { Watchlist } from '../../core/services/watchlist.service';
import { WatchlistStore } from '../../core/watchlists/watchlist.store';
import { provideApi } from '../../generated/trade-client';
import { WatchlistCard } from './watchlist-card';

const TRADE = 'http://trade.test';
const ACCOUNT = `${TRADE}/api/v1/accounts/42`;
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';
const LIST = '6f1c1c0e-8c1e-4d3b-9a43-0d4f1f0d2a11';

const QUOTES = [
  { symbol: 'HDFCBANK', name: 'HDFC Bank', price: 1700, bid: null, ask: null, currency: 'INR', change: 1, changePercent: 0.1, previousClose: 1699, marketState: 'OPEN', stale: false, quoteAsOf: null, receivedAt: null },
  { symbol: 'INFY', name: 'Infosys', price: 1620, bid: null, ask: null, currency: 'INR', change: 1, changePercent: 0.7, previousClose: 1608, marketState: 'OPEN', stale: false, quoteAsOf: null, receivedAt: null },
  { symbol: 'ITC', name: 'ITC', price: 400, bid: null, ask: null, currency: 'INR', change: 1, changePercent: 0.2, previousClose: 399, marketState: 'OPEN', stale: false, quoteAsOf: null, receivedAt: null },
  { symbol: 'TCS', name: 'Tata Consultancy Services', price: 3050, bid: null, ask: null, currency: 'INR', change: -25, changePercent: -0.8, previousClose: 3075, marketState: 'OPEN', stale: false, quoteAsOf: null, receivedAt: null }
];

function entry(symbol: string, overrides: Record<string, unknown> = {}) {
  return { symbol, name: symbol + ' Ltd', price: 100, currency: 'INR', changePercent: 0.5, stale: false, quoteAsOf: null, ...overrides };
}

function list(instruments = [entry('HDFCBANK'), entry('ITC', { price: null, changePercent: null })]): Watchlist {
  return { id: LIST, name: 'Banks', createdAt: '2026-10-06T09:15:00Z', instruments };
}

@Component({
  imports: [WatchlistCard],
  template: `<tui-watchlist-card [watchlist]="watchlist()" [showHeader]="header()" [compact]="compact()" />`
})
class Host {
  readonly watchlist = signal<Watchlist>(list());
  readonly header = signal(true);
  readonly compact = signal(false);
}

describe('WatchlistCard', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let http: HttpTestingController;
  let store: WatchlistStore;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string): T | null => root().querySelector<T>(`[data-testid="${id}"]`);
  const all = (id: string): HTMLElement[] => Array.from(root().querySelectorAll(`[data-testid="${id}"]`));
  const text = (el: HTMLElement | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function setUp(): Promise<void> {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: TRADE }), provideRouter([])]
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).signIn(TOKEN, null, null);
    store = TestBed.inject(WatchlistStore);
    store.start();
    http.expectOne(`${ACCOUNT}/watchlists`).flush([list()]);
    http.expectOne(`${ACCOUNT}/alerts`).flush([]);
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne(`${TRADE}/api/v1/market/quotes`).flush(QUOTES);
    await settle();
  }

  async function openPicker(): Promise<void> {
    (q('instrument-picker-input') as HTMLInputElement).dispatchEvent(new Event('focus'));
    await settle();
  }

  const option = (symbol: string): HTMLElement | null => q(`picker-option-${symbol}`);

  afterEach(() => {
    store?.stop();
    http?.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('what is on the list', () => {
    it('shows each entry with its name, live price and change, and says when there is no price yet', async () => {
      await setUp();

      expect(text(q('watchlist-title'))).toBe('Banks');
      expect(all('entry-symbol').map(text)).toEqual(['HDFCBANK', 'ITC']);
      expect(text(q('entry-HDFCBANK')?.querySelector('[data-testid="entry-price"]') as HTMLElement)).toContain('100.00');
      expect(text(q('entry-HDFCBANK')?.querySelector('[data-testid="entry-change"]') as HTMLElement)).toContain('+0.50%');
      expect(text(q('entry-no-price'))).toBe('No price yet');
    });

    it('flags a delayed price', async () => {
      await setUp();
      host.watchlist.set(list([entry('TCS', { stale: true })]));
      await settle();

      expect(text(q('entry-stale'))).toBe('Delayed');
    });

    it('says so when the list is empty', async () => {
      await setUp();
      host.watchlist.set(list([]));
      await settle();

      expect(q('watchlist-no-instruments')).not.toBeNull();
    });

    it('hides the title and Delete button when the header is off, and tucks the name under the symbol when compact', async () => {
      await setUp();
      host.header.set(false);
      host.compact.set(true);
      await settle();

      expect(q('watchlist-title')).toBeNull();
      expect(q('watchlist-delete')).toBeNull();
      expect(q('entry-HDFCBANK')?.textContent).toContain('HDFCBANK Ltd');
      expect(root().querySelectorAll('thead th').length).toBe(4); // no separate Name column
    });
  });

  describe('adding several instruments at once', () => {
    it('offers every instrument in the search box, with the ones already on the list marked', async () => {
      await setUp();
      await openPicker();

      expect(['INFY', 'TCS', 'HDFCBANK', 'ITC'].every((s) => option(s) !== null)).toBe(true);
      expect(option('HDFCBANK')?.getAttribute('aria-disabled')).toBe('true');
      expect(option('HDFCBANK')?.textContent).toContain('In this watchlist');
      expect(option('TCS')?.getAttribute('aria-disabled')).toBe('false');
    });

    it('collects a few, adds them all with one press, and clears the selection', async () => {
      await setUp();
      await openPicker();
      option('TCS')?.click();
      await settle();
      option('INFY')?.click();
      await settle();
      expect(text(q('instrument-add'))).toBe('Add 2');

      q('instrument-add')?.click();
      await settle();
      http.expectOne((r) => r.body?.symbol === 'TCS').flush(entry('TCS'));
      http.expectOne((r) => r.body?.symbol === 'INFY').flush(entry('INFY'));
      await settle();

      expect(store.watchlists()[0].instruments.map((i) => i.symbol)).toEqual(['HDFCBANK', 'ITC', 'TCS', 'INFY']);
      expect(text(q('instrument-added'))).toContain('Added 2 instruments to Banks');
      expect(all('picker-chip')).toHaveLength(0);
    });

    it('names the instrument when only one was added', async () => {
      await setUp();
      await openPicker();
      option('TCS')?.click();
      await settle();

      q('instrument-add')?.click();
      http.expectOne((r) => r.body?.symbol === 'TCS').flush(entry('TCS'));
      await settle();

      expect(text(q('instrument-added'))).toContain('Added TCS to Banks');
    });

    it('keeps an instrument that was refused chosen, so it can be seen, and shows why', async () => {
      await setUp();
      await openPicker();
      option('TCS')?.click();
      await settle();
      option('INFY')?.click();
      await settle();

      q('instrument-add')?.click();
      http.expectOne((r) => r.body?.symbol === 'TCS').flush(entry('TCS'));
      http.expectOne((r) => r.body?.symbol === 'INFY').flush({ errorCode: 'WLT-429', message: 'x' }, { status: 429, statusText: 'Too Many' });
      await settle();

      expect(all('picker-chip').map(text)).toEqual(['INFY']);
      expect(text(q('watchlist-error'))).toContain('50 instruments');
    });

    it('has its Add button off until something is chosen', async () => {
      await setUp();

      expect((q<HTMLButtonElement>('instrument-add') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('changing the list', () => {
    it('removes an instrument', async () => {
      await setUp();

      (q('entry-ITC')?.querySelector('[data-testid="entry-remove"]') as HTMLElement).click();
      http.expectOne(`${ACCOUNT}/watchlists/${LIST}/instruments/ITC`).flush(null);
      await settle();

      expect(store.watchlists()[0].instruments.map((i) => i.symbol)).toEqual(['HDFCBANK']);
    });

    it('deletes the whole watchlist', async () => {
      await setUp();

      q('watchlist-delete')?.click();
      http.expectOne(`${ACCOUNT}/watchlists/${LIST}`).flush(null);
      await settle();

      expect(store.watchlists()).toEqual([]);
    });

    it('links each entry to setting an alert on it', async () => {
      await setUp();

      const link = q('entry-HDFCBANK')?.querySelector('[data-testid="entry-alert"]') as HTMLAnchorElement;

      expect(link.getAttribute('href')).toBe('/app/watchlists?alert=HDFCBANK');
      expect(link.getAttribute('aria-label')).toBe('Set a price alert on HDFCBANK');
    });
  });
});
