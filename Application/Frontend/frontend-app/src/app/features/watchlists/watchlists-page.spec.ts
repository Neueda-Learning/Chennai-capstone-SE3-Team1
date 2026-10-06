import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SessionStore } from '../../core/auth/session.store';
import { PriceAlert, Watchlist } from '../../core/services/watchlist.service';
import { provideApi } from '../../generated/trade-client';
import { REFRESH_MS, WatchlistsPage } from './watchlists-page';

const BASE = 'http://trade.test/api/v1/accounts/42';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';
const LIST_ID = '6f1c1c0e-8c1e-4d3b-9a43-0d4f1f0d2a11';

function watchlist(overrides: Partial<Watchlist> = {}): Watchlist {
  return {
    id: LIST_ID,
    name: 'Banks',
    createdAt: '2026-10-06T09:15:00Z',
    instruments: [
      { symbol: 'HDFCBANK', name: 'HDFC Bank', price: 1650.5, currency: 'INR', changePercent: 0.09, stale: false, quoteAsOf: '2026-10-06T09:15:00Z' },
      { symbol: 'ITC', name: 'ITC', price: null, currency: null, changePercent: null, stale: false, quoteAsOf: null }
    ],
    ...overrides
  };
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

describe('WatchlistsPage', () => {
  let http: HttpTestingController;

  function setUp(lists: Watchlist[] = [watchlist()], alerts: PriceAlert[] = []): ComponentFixture<WatchlistsPage> {
    TestBed.configureTestingModule({
      imports: [WatchlistsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: 'http://trade.test' })]
    });
    TestBed.inject(SessionStore).signIn(TOKEN, null, null);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(WatchlistsPage);
    fixture.detectChanges();
    http.expectOne(`${BASE}/watchlists`).flush(lists);
    http.expectOne(`${BASE}/alerts`).flush(alerts);
    fixture.detectChanges();
    return fixture;
  }

  const one = (fixture: ComponentFixture<WatchlistsPage>, testId: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const all = (fixture: ComponentFixture<WatchlistsPage>, testId: string) =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const text = (el: HTMLElement | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  function type(fixture: ComponentFixture<WatchlistsPage>, testId: string, value: string): void {
    const input = one(fixture, testId) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  afterEach(() => {
    http?.verify();
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows each watchlist with a live price beside every entry, and says so when there is none yet', () => {
    const fixture = setUp();

    expect(text(one(fixture, 'watchlist-title'))).toBe('Banks');
    expect(text(one(fixture, 'entry-HDFCBANK'))).toContain('1,650.50');
    expect(text(one(fixture, 'entry-HDFCBANK'))).toContain('+0.09%');
    expect(text(one(fixture, 'entry-ITC'))).toContain('No price yet');
  });

  it('marks a delayed price', () => {
    const list = watchlist();
    list.instruments[0].stale = true;
    const fixture = setUp([list]);

    expect(one(fixture, 'entry-stale')).not.toBeNull();
  });

  it('invites the first watchlist when there are none', () => {
    const fixture = setUp([]);

    expect(one(fixture, 'watchlist-empty')).not.toBeNull();
    expect(one(fixture, 'alert-empty')).not.toBeNull();
  });

  it('creates a watchlist with the typed name and shows it', () => {
    const fixture = setUp([]);

    type(fixture, 'watchlist-name', '  Banks ');
    one(fixture, 'watchlist-create')!.click();

    const request = http.expectOne(`${BASE}/watchlists`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Banks' });
    request.flush(watchlist({ instruments: [] }));
    fixture.detectChanges();

    expect(text(one(fixture, 'watchlist-title'))).toBe('Banks');
    expect((one(fixture, 'watchlist-name') as HTMLInputElement).value).toBe('');
  });

  it('does not call the server for a blank name', () => {
    const fixture = setUp([]);

    type(fixture, 'watchlist-name', '   ');
    one(fixture, 'watchlist-create')!.click();

    http.expectNone(`${BASE}/watchlists`);
  });

  it('shows the catalogue message for a duplicate name and a full account', () => {
    const fixture = setUp([]);
    type(fixture, 'watchlist-name', 'Banks');

    one(fixture, 'watchlist-create')!.click();
    http.expectOne(`${BASE}/watchlists`).flush({ errorCode: 'WLT-409', message: 'x' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(text(one(fixture, 'watchlist-error'))).toBe('You already have a watchlist with that name.');

    one(fixture, 'watchlist-create')!.click();
    http.expectOne(`${BASE}/watchlists`).flush({ errorCode: 'WLT-429', message: 'x' }, { status: 429, statusText: 'Too Many Requests' });
    fixture.detectChanges();
    expect(text(one(fixture, 'watchlist-error'))).toContain('limit');
  });

  it('adds an instrument and shows its price', () => {
    const fixture = setUp([watchlist({ instruments: [] })]);

    type(fixture, 'instrument-symbol', 'tcs');
    one(fixture, 'instrument-add')!.click();

    const request = http.expectOne(`${BASE}/watchlists/${LIST_ID}/instruments`);
    expect(request.request.body).toEqual({ symbol: 'tcs' });
    request.flush({ symbol: 'TCS', name: 'Tata Consultancy Services', price: 3501.25, currency: 'INR', changePercent: 0.5, stale: false, quoteAsOf: null });
    fixture.detectChanges();

    expect(text(one(fixture, 'entry-TCS'))).toContain('3,501.25');
    expect((one(fixture, 'instrument-symbol') as HTMLInputElement).value).toBe('');
  });

  it('explains an unknown symbol', () => {
    const fixture = setUp();

    type(fixture, 'instrument-symbol', 'NOPE');
    one(fixture, 'instrument-add')!.click();
    http.expectOne(`${BASE}/watchlists/${LIST_ID}/instruments`).flush(
      { errorCode: 'WLT-422', message: 'x' },
      { status: 422, statusText: 'Unprocessable Entity' }
    );
    fixture.detectChanges();

    expect(text(one(fixture, 'watchlist-error'))).toBe('That symbol is not one that can be watched.');
  });

  it('removes an instrument and deletes a watchlist', () => {
    const fixture = setUp();

    all(fixture, 'entry-remove')[1].click();
    const removal = http.expectOne(`${BASE}/watchlists/${LIST_ID}/instruments/ITC`);
    expect(removal.request.method).toBe('DELETE');
    removal.flush(null);
    fixture.detectChanges();
    expect(one(fixture, 'entry-ITC')).toBeNull();
    expect(one(fixture, 'entry-HDFCBANK')).not.toBeNull();

    one(fixture, 'watchlist-delete')!.click();
    http.expectOne(`${BASE}/watchlists/${LIST_ID}`).flush(null);
    fixture.detectChanges();
    expect(one(fixture, 'watchlist-title')).toBeNull();
  });

  it('shows alert state and, for a triggered alert, where it was delivered', () => {
    const fixture = setUp([], [
      alert('a-1'),
      alert('a-2', { state: 'FIRED', deliveryState: 'QUEUED', firedPrice: 3501, firedAt: '2026-10-06T09:15:00Z' }),
      alert('a-3', { state: 'FIRED', deliveryState: 'PENDING_CHANNEL', firedPrice: 3501, firedAt: '2026-10-06T09:15:00Z' }),
      alert('a-4', { state: 'FIRED', deliveryState: 'DELIVERY_FAILED', firedPrice: 3501, firedAt: '2026-10-06T09:15:00Z' })
    ]);

    const states = all(fixture, 'alert-state').map((el) => text(el));
    expect(states).toEqual(['Watching', 'Triggered', 'Triggered', 'Triggered']);
    expect(text(one(fixture, 'alert-a-1'))).toContain('rises to or above');
    expect(one(fixture, 'alert-a-1')!.querySelector('[data-testid="alert-delivery"]')).toBeNull();
    expect(text(one(fixture, 'alert-a-2')!.querySelector('[data-testid="alert-delivery"]'))).toBe('Sent to your notifications');
    expect(text(one(fixture, 'alert-a-3')!.querySelector('[data-testid="alert-delivery"]'))).toContain('Settings');
    expect(text(one(fixture, 'alert-a-4')!.querySelector('[data-testid="alert-delivery"]'))).toContain('Could not be handed');
  });

  it('creates an alert from the symbol, direction and threshold', () => {
    const fixture = setUp();

    type(fixture, 'alert-symbol', 'TCS');
    type(fixture, 'alert-threshold', '3500.50');
    const direction = one(fixture, 'alert-direction') as HTMLSelectElement;
    direction.value = 'BELOW';
    direction.dispatchEvent(new Event('change'));
    one(fixture, 'alert-create')!.click();

    const request = http.expectOne(`${BASE}/alerts`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ symbol: 'TCS', threshold: 3500.5, direction: 'BELOW' });
    request.flush(alert('a-9', { direction: 'BELOW', threshold: 3500.5 }));
    fixture.detectChanges();

    expect(text(one(fixture, 'alert-a-9'))).toContain('falls to or below');
  });

  it('refuses a missing or non-positive threshold without calling the server', () => {
    const fixture = setUp();

    type(fixture, 'alert-symbol', 'TCS');
    one(fixture, 'alert-create')!.click();
    fixture.detectChanges();
    expect(one(fixture, 'alert-error')).not.toBeNull();

    type(fixture, 'alert-threshold', '0');
    one(fixture, 'alert-create')!.click();

    http.expectNone(`${BASE}/alerts`);
  });

  it('shows the cap message when the twenty-sixth alert is refused', () => {
    const fixture = setUp();
    type(fixture, 'alert-symbol', 'TCS');
    type(fixture, 'alert-threshold', '10');

    one(fixture, 'alert-create')!.click();
    http.expectOne(`${BASE}/alerts`).flush({ errorCode: 'WLT-429', message: 'x' }, { status: 429, statusText: 'Too Many Requests' });
    fixture.detectChanges();

    expect(text(one(fixture, 'alert-error'))).toContain('25 alerts');
  });

  it('re-arms a triggered alert, turns off a watching one, and deletes', () => {
    const fixture = setUp([], [
      alert('a-1'),
      alert('a-2', { state: 'FIRED', deliveryState: 'QUEUED', firedPrice: 3501, firedAt: '2026-10-06T09:15:00Z' })
    ]);

    one(fixture, 'alert-a-2')!.querySelector<HTMLElement>('[data-testid="alert-rearm"]')!.click();
    const rearm = http.expectOne(`${BASE}/alerts/a-2`);
    expect(rearm.request.method).toBe('PATCH');
    expect(rearm.request.body).toEqual({ state: 'ARMED' });
    rearm.flush(alert('a-2'));
    fixture.detectChanges();
    expect(text(one(fixture, 'alert-a-2')!.querySelector('[data-testid="alert-state"]'))).toBe('Watching');

    one(fixture, 'alert-a-1')!.querySelector<HTMLElement>('[data-testid="alert-disable"]')!.click();
    const disable = http.expectOne(`${BASE}/alerts/a-1`);
    expect(disable.request.body).toEqual({ state: 'DISABLED' });
    disable.flush(alert('a-1', { state: 'DISABLED' }));
    fixture.detectChanges();
    expect(text(one(fixture, 'alert-a-1')!.querySelector('[data-testid="alert-state"]'))).toBe('Off');

    one(fixture, 'alert-a-1')!.querySelector<HTMLElement>('[data-testid="alert-delete"]')!.click();
    http.expectOne(`${BASE}/alerts/a-1`).flush(null);
    fixture.detectChanges();
    expect(one(fixture, 'alert-a-1')).toBeNull();
  });

  it('refreshes prices and alert state on a timer, and stops when the page is left', () => {
    vi.useFakeTimers();
    const fixture = setUp();

    vi.advanceTimersByTime(REFRESH_MS);
    const refreshed = watchlist();
    refreshed.instruments[0].price = 1700;
    http.expectOne(`${BASE}/watchlists`).flush([refreshed]);
    http.expectOne(`${BASE}/alerts`).flush([alert('a-1', { state: 'FIRED', deliveryState: 'QUEUED', firedPrice: 3501, firedAt: '2026-10-06T09:15:00Z' })]);
    fixture.detectChanges();

    expect(text(one(fixture, 'entry-HDFCBANK'))).toContain('1,700.00');
    expect(text(one(fixture, 'alert-state'))).toBe('Triggered');

    fixture.destroy();
    vi.advanceTimersByTime(REFRESH_MS * 2);
    http.expectNone(`${BASE}/watchlists`);
  });

  it('keeps showing the last prices when a background refresh fails', () => {
    vi.useFakeTimers();
    const fixture = setUp();

    vi.advanceTimersByTime(REFRESH_MS);
    http.expectOne(`${BASE}/watchlists`).flush({ errorCode: 'INTERNAL-500', message: 'x' }, { status: 500, statusText: 'Server Error' });
    http.expectOne(`${BASE}/alerts`).flush({ errorCode: 'INTERNAL-500', message: 'x' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(one(fixture, 'entry-HDFCBANK')).not.toBeNull();
    expect(one(fixture, 'watchlist-error')).toBeNull();
  });
});
