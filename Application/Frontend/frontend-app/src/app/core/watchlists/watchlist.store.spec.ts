import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { provideApi } from '../../generated/trade-client';
import { SessionStore } from '../auth/session.store';
import { PriceAlert, Watchlist } from '../services/watchlist.service';
import { REFRESH_MS, WatchlistStore } from './watchlist.store';

const BASE = 'http://trade.test/api/v1/accounts/42';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';
const LIST = '6f1c1c0e-8c1e-4d3b-9a43-0d4f1f0d2a11';

function entry(symbol: string) {
  return { symbol, name: symbol + ' Ltd', price: 100, currency: 'INR', changePercent: 0.5, stale: false, quoteAsOf: null };
}

function list(instruments: string[] = ['HDFCBANK'], id = LIST): Watchlist {
  return { id, name: 'Banks', createdAt: '2026-10-06T09:15:00Z', instruments: instruments.map(entry) };
}

function alert(id: string, overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id,
    symbol: 'TCS',
    threshold: 3500,
    direction: 'ABOVE',
    state: 'ARMED',
    deliveryState: null,
    firedAt: null,
    firedPrice: null,
    createdAt: '2026-10-06T09:00:00Z',
    ...overrides
  };
}

describe('WatchlistStore', () => {
  let http: HttpTestingController;
  let store: WatchlistStore;
  let session: SessionStore;

  function configure(signedIn = true): void {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: 'http://trade.test' })]
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
    if (signedIn) {
      session.signIn(TOKEN, null, null);
    }
    store = TestBed.inject(WatchlistStore);
    TestBed.tick();
  }

  function load(lists: Watchlist[] = [list()], alerts: PriceAlert[] = []): void {
    store.start();
    http.expectOne(`${BASE}/watchlists`).flush(lists);
    http.expectOne(`${BASE}/alerts`).flush(alerts);
  }

  afterEach(() => {
    store?.stop();
    http?.verify();
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('loading and polling', () => {
    it('loads the watchlists and alerts when the first page opens', () => {
      configure();

      load([list()], [alert('a1')]);

      expect(store.watchlists()).toHaveLength(1);
      expect(store.alerts()).toHaveLength(1);
      expect(store.loaded()).toBe(true);
      expect(store.loading()).toBe(false);
    });

    it('polls while any page is open, and a second page does not start a second poll', () => {
      vi.useFakeTimers();
      configure();
      load();
      store.start(); // a second page opens: no extra fetch

      http.expectNone(`${BASE}/watchlists`);
      vi.advanceTimersByTime(REFRESH_MS);
      http.expectOne(`${BASE}/watchlists`).flush([list()]);
      http.expectOne(`${BASE}/alerts`).flush([]);
      store.stop();
    });

    it('stops polling only when the last page closes', () => {
      vi.useFakeTimers();
      configure();
      load();
      store.start();
      store.stop(); // one page left

      vi.advanceTimersByTime(REFRESH_MS);
      http.expectOne(`${BASE}/watchlists`).flush([list()]);
      http.expectOne(`${BASE}/alerts`).flush([]);

      store.stop(); // none left
      vi.advanceTimersByTime(REFRESH_MS * 3);
      http.expectNone(`${BASE}/watchlists`);
    });

    it('shows a load error the first time, but a failed background refresh keeps the last data quietly', () => {
      vi.useFakeTimers();
      configure();
      store.start();
      http.expectOne(`${BASE}/watchlists`).flush({ errorCode: 'INTERNAL-500' }, { status: 500, statusText: 'Error' });
      http.expectOne(`${BASE}/alerts`).flush({ errorCode: 'INTERNAL-500' }, { status: 500, statusText: 'Error' });
      expect(store.error()).not.toBeNull();
      expect(store.alertError()).not.toBeNull();

      store.stop();
      TestBed.resetTestingModule();
      vi.useFakeTimers();
      configure();
      load([list(['TCS'])], [alert('a1')]);
      vi.advanceTimersByTime(REFRESH_MS);
      http.expectOne(`${BASE}/watchlists`).flush({}, { status: 503, statusText: 'Unavailable' });
      http.expectOne(`${BASE}/alerts`).flush({}, { status: 503, statusText: 'Unavailable' });

      expect(store.error()).toBeNull();
      expect(store.watchlists()[0].instruments[0].symbol).toBe('TCS');
    });

    it('does nothing without an account', () => {
      configure(false);

      store.start();

      http.expectNone(() => true);
      expect(store.watchlists()).toEqual([]);
    });

    it('loads once when a page starts it: creating the store does not fetch or wipe a second time', () => {
      configure();
      load([list()], [alert('a1')]);

      TestBed.tick();
      TestBed.tick();

      http.expectNone(`${BASE}/watchlists`);
      http.expectNone(`${BASE}/alerts`);
      expect(store.watchlists()).toHaveLength(1);
      expect(store.alerts()).toHaveLength(1);
    });

    it('drops the previous customer lists and loads the new customer lists when the account changes', () => {
      configure();
      load([list()], [alert('a1')]);

      session.signIn('eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQzfQ.signature', null, null); // account 43
      TestBed.tick();

      expect(store.watchlists()).toEqual([]);
      expect(store.alerts()).toEqual([]);
      http.expectOne('http://trade.test/api/v1/accounts/43/watchlists').flush([list(['TCS'], 'other')]);
      http.expectOne('http://trade.test/api/v1/accounts/43/alerts').flush([]);
      expect(store.watchlists()[0].id).toBe('other');
    });

    it('clears everything when the customer signs out', () => {
      configure();
      load([list()], [alert('a1')]);

      session.signOut();
      TestBed.tick();

      expect(store.watchlists()).toEqual([]);
      expect(store.alerts()).toEqual([]);
      expect(store.loaded()).toBe(false);
    });
  });

  describe('derived views', () => {
    it('lists every watched symbol across watchlists, the armed alerts, and the alerts for one symbol', () => {
      configure();
      load(
        [list(['TCS', 'INFY'], 'a'), list(['INFY', 'ITC'], 'b')],
        [alert('1'), alert('2', { state: 'FIRED' }), alert('3', { symbol: 'INFY' }), alert('4', { state: 'DISABLED' })]
      );

      expect([...store.watchedSymbols()].sort()).toEqual(['INFY', 'ITC', 'TCS']);
      expect(store.armedAlerts().map((a) => a.id)).toEqual(['1', '3']);
      expect(store.alertsFor('TCS').map((a) => a.id)).toEqual(['1', '2', '4']);
      expect(store.alertsFor(null)).toEqual([]);
    });
  });

  describe('watchlists', () => {
    it('creates one, trimmed, and shows it', () => {
      configure();
      load([]);
      let done: boolean | undefined;

      store.createWatchlist('  Banks  ').subscribe((ok) => (done = ok));
      const request = http.expectOne(`${BASE}/watchlists`);
      expect(request.request.body).toEqual({ name: 'Banks' });
      request.flush(list());

      expect(done).toBe(true);
      expect(store.watchlists()).toHaveLength(1);
    });

    it('does not call the service for a blank name', () => {
      configure();
      load([]);
      let done: boolean | undefined;

      store.createWatchlist('   ').subscribe((ok) => (done = ok));

      http.expectNone(`${BASE}/watchlists`);
      expect(done).toBe(false);
    });

    it('reports the reason a create or delete was refused, and changes nothing', () => {
      configure();
      load([list()]);
      let created: boolean | undefined;
      let deleted: boolean | undefined;

      store.createWatchlist('Banks').subscribe((ok) => (created = ok));
      http.expectOne(`${BASE}/watchlists`).flush({ errorCode: 'WLT-409', message: 'x' }, { status: 409, statusText: 'Conflict' });
      expect(created).toBe(false);
      expect(store.error()).toContain('already have a watchlist');

      store.deleteWatchlist(LIST).subscribe((ok) => (deleted = ok));
      http.expectOne(`${BASE}/watchlists/${LIST}`).flush({ errorCode: 'WLT-404', message: 'x' }, { status: 404, statusText: 'Not Found' });
      expect(deleted).toBe(false);
      expect(store.watchlists()).toHaveLength(1);
    });

    it('deletes one', () => {
      configure();
      load([list()]);

      store.deleteWatchlist(LIST).subscribe();
      http.expectOne(`${BASE}/watchlists/${LIST}`).flush(null);

      expect(store.watchlists()).toEqual([]);
    });

    it('adds several instruments at once, one request each, and shows them all', () => {
      configure();
      load([list(['HDFCBANK'])]);
      let outcome: { added: string[]; failed: string[] } | undefined;

      store.addInstruments(LIST, ['TCS', 'INFY', 'TCS']).subscribe((o) => (outcome = o));
      http.expectOne((r) => r.url === `${BASE}/watchlists/${LIST}/instruments` && r.body.symbol === 'TCS').flush(entry('TCS'));
      http.expectOne((r) => r.url === `${BASE}/watchlists/${LIST}/instruments` && r.body.symbol === 'INFY').flush(entry('INFY'));

      expect(outcome).toEqual({ added: ['TCS', 'INFY'], failed: [] });
      expect(store.watchlists()[0].instruments.map((i) => i.symbol)).toEqual(['HDFCBANK', 'TCS', 'INFY']);
    });

    it('keeps the ones that went in when another is refused, and says which failed', () => {
      configure();
      load([list(['HDFCBANK'])]);
      let outcome: { added: string[]; failed: string[] } | undefined;

      store.addInstruments(LIST, ['TCS', 'GHOST']).subscribe((o) => (outcome = o));
      http.expectOne((r) => r.body?.symbol === 'TCS').flush(entry('TCS'));
      http.expectOne((r) => r.body?.symbol === 'GHOST').flush({ errorCode: 'WLT-422', message: 'x' }, { status: 422, statusText: 'Unprocessable' });

      expect(outcome).toEqual({ added: ['TCS'], failed: ['GHOST'] });
      expect(store.watchlists()[0].instruments.map((i) => i.symbol)).toEqual(['HDFCBANK', 'TCS']);
      expect(store.error()).toContain('not one that can be watched');
    });

    it('does not list an instrument twice if the service returns one already shown', () => {
      configure();
      load([list(['TCS'])]);

      store.addInstruments(LIST, ['TCS']).subscribe();
      http.expectOne((r) => r.body?.symbol === 'TCS').flush(entry('TCS'));

      expect(store.watchlists()[0].instruments).toHaveLength(1);
    });

    it('adds nothing, and calls nothing, for an empty selection', () => {
      configure();
      load();
      let outcome: unknown;

      store.addInstruments(LIST, []).subscribe((o) => (outcome = o));

      expect(outcome).toEqual({ added: [], failed: [] });
    });

    it('removes an instrument', () => {
      configure();
      load([list(['HDFCBANK', 'ITC'])]);

      store.removeInstrument(LIST, 'ITC').subscribe();
      http.expectOne(`${BASE}/watchlists/${LIST}/instruments/ITC`).flush(null);

      expect(store.watchlists()[0].instruments.map((i) => i.symbol)).toEqual(['HDFCBANK']);
    });
  });

  describe('alerts', () => {
    it('creates an alert and shows it first', () => {
      configure();
      load([], [alert('old')]);
      let ok: boolean | undefined;

      store.createAlert({ symbol: 'TCS', threshold: 3600, direction: 'ABOVE' }).subscribe((v) => (ok = v));
      const request = http.expectOne(`${BASE}/alerts`);
      expect(request.request.body).toEqual({ symbol: 'TCS', threshold: 3600, direction: 'ABOVE' });
      request.flush(alert('new', { threshold: 3600 }));

      expect(ok).toBe(true);
      expect(store.alerts().map((a) => a.id)).toEqual(['new', 'old']);
    });

    it('explains a refused alert (the 25-alert limit) and adds nothing', () => {
      configure();
      load([], []);
      let ok: boolean | undefined;

      store.createAlert({ symbol: 'TCS', threshold: 1, direction: 'BELOW' }).subscribe((v) => (ok = v));
      http.expectOne(`${BASE}/alerts`).flush({ errorCode: 'WLT-429', message: 'x' }, { status: 429, statusText: 'Too Many' });

      expect(ok).toBe(false);
      expect(store.alertError()).toContain('25 alerts');
      expect(store.alerts()).toEqual([]);
    });

    it('turns an alert off and back on', () => {
      configure();
      load([], [alert('a1')]);

      store.setAlertState('a1', 'DISABLED').subscribe();
      const off = http.expectOne(`${BASE}/alerts/a1`);
      expect(off.request.method).toBe('PATCH');
      expect(off.request.body).toEqual({ state: 'DISABLED' });
      off.flush(alert('a1', { state: 'DISABLED' }));
      expect(store.alerts()[0].state).toBe('DISABLED');

      store.setAlertState('a1', 'ARMED').subscribe();
      http.expectOne(`${BASE}/alerts/a1`).flush(alert('a1'));
      expect(store.alerts()[0].state).toBe('ARMED');
    });

    it('deletes an alert', () => {
      configure();
      load([], [alert('a1'), alert('a2')]);

      store.deleteAlert('a1').subscribe();
      http.expectOne(`${BASE}/alerts/a1`).flush(null);

      expect(store.alerts().map((a) => a.id)).toEqual(['a2']);
    });

    it('does nothing without an account', () => {
      configure(false);
      const results: boolean[] = [];

      store.createAlert({ symbol: 'TCS', threshold: 1, direction: 'ABOVE' }).subscribe((v) => results.push(v));
      store.setAlertState('a', 'ARMED').subscribe((v) => results.push(v));
      store.deleteAlert('a').subscribe((v) => results.push(v));

      http.expectNone(() => true);
      expect(results).toEqual([false, false, false]);
    });
  });
});
