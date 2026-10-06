import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SessionStore } from '../../core/auth/session.store';
import { PriceAlert } from '../../core/services/watchlist.service';
import { WatchlistStore } from '../../core/watchlists/watchlist.store';
import { provideApi } from '../../generated/trade-client';
import { AlertList } from './alert-list';

const TRADE = 'http://trade.test';
const ACCOUNT = `${TRADE}/api/v1/accounts/42`;
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';

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

@Component({
  imports: [AlertList],
  template: `<tui-alert-list [alerts]="alerts()" [prices]="prices()" [limit]="limit()" [compact]="compact()" (selectSymbol)="picked.push($event)" />`
})
class Host {
  readonly alerts = signal<PriceAlert[]>([]);
  readonly prices = signal<Record<string, number | null>>({ TCS: 3000 });
  readonly limit = signal<number | null>(null);
  readonly compact = signal(false);
  readonly picked: string[] = [];
}

describe('AlertList', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let http: HttpTestingController;
  let store: WatchlistStore;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string): T | null => root().querySelector<T>(`[data-testid="${id}"]`);
  const text = (el: HTMLElement | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const ids = (): string[] =>
    Array.from(root().querySelectorAll('li[data-testid^="alert-"]')).map((li) => (li.getAttribute('data-testid') ?? '').slice('alert-'.length));

  async function setUp(alerts: PriceAlert[] = []): Promise<void> {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: TRADE })]
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).signIn(TOKEN, null, null);
    store = TestBed.inject(WatchlistStore);
    store.start();
    http.expectOne(`${ACCOUNT}/watchlists`).flush([]);
    http.expectOne(`${ACCOUNT}/alerts`).flush(alerts);
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    host.alerts.set(alerts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    store?.stop();
    http?.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('says so when there are none', async () => {
    await setUp([]);

    expect(text(q('alert-empty'))).toContain('no price alerts');
  });

  it('puts alerts that are still watching first, then triggered ones, then those switched off', async () => {
    await setUp([alert('off', { state: 'DISABLED' }), alert('fired', { state: 'FIRED' }), alert('armed')]);

    expect(ids()).toEqual(['armed', 'fired', 'off']);
  });

  it('shows the level, the way it waits, and how far the price is from it', async () => {
    await setUp([alert('a', { threshold: 3150 })]);

    expect(text(q('alert-threshold'))).toContain('3,150.00');
    expect(text(q('alert-distance'))).toBe('5.0% to go');
    expect(root().textContent).toContain('rises to or above');
  });

  it('shows no distance for an alert that is not watching, or for a stock with no price', async () => {
    await setUp([alert('fired', { state: 'FIRED' }), alert('nope', { symbol: 'INFY' })]);

    expect(root().querySelectorAll('[data-testid="alert-distance"]')).toHaveLength(0);
  });

  it('says where and when a triggered alert fired, and where its notification went', async () => {
    await setUp([alert('f', { state: 'FIRED', firedPrice: 3510, firedAt: '2026-10-06T09:30:00Z', deliveryState: 'QUEUED' })]);

    expect(text(q('alert-fired'))).toContain('3,510.00');
    expect(text(q('alert-delivery'))).toBe('Sent to your notifications');
    expect(q('alert-delivery')?.getAttribute('data-delivery')).toBe('QUEUED');
  });

  it('explains each way a notification can fail to go out', async () => {
    await setUp([
      alert('p', { state: 'FIRED', deliveryState: 'PENDING_CHANNEL' }),
      alert('r', { state: 'FIRED', deliveryState: 'REJECTED' }),
      alert('d', { state: 'FIRED', deliveryState: 'DELIVERY_FAILED' }),
      alert('n', { state: 'FIRED', deliveryState: null })
    ]);

    const messages = Array.from(root().querySelectorAll('[data-testid="alert-delivery"]')).map((e) => text(e as HTMLElement));
    expect(messages).toEqual([
      'Waiting for you to choose a channel in Settings',
      'Notifications refused it',
      'Could not be handed to notifications',
      'Handing over to notifications'
    ]);
  });

  it('shows only the first few in a small space, and counts the rest', async () => {
    await setUp([alert('1'), alert('2'), alert('3'), alert('4')]);
    host.limit.set(2);
    fixture.detectChanges();

    expect(ids()).toEqual(['1', '2']);
    expect(text(q('alert-more'))).toBe('+ 2 more');
  });

  it('omits the plain-words sentence when compact', async () => {
    await setUp([alert('a')]);
    host.compact.set(true);
    fixture.detectChanges();

    expect(root().textContent).not.toContain('When TCS rises');
  });

  it('tells the page which stock was clicked', async () => {
    await setUp([alert('a')]);

    q('alert-symbol')?.click();

    expect(host.picked).toEqual(['TCS']);
  });

  it('turns an alert off and back on, and deletes it', async () => {
    await setUp([alert('a')]);
    host.alerts.set(store.alerts());
    fixture.detectChanges();

    q('alert-disable')?.click();
    const off = http.expectOne(`${ACCOUNT}/alerts/a`);
    expect(off.request.body).toEqual({ state: 'DISABLED' });
    off.flush(alert('a', { state: 'DISABLED' }));
    host.alerts.set(store.alerts());
    fixture.detectChanges();
    expect(q('alert-rearm')).not.toBeNull();

    q('alert-rearm')?.click();
    expect(http.expectOne(`${ACCOUNT}/alerts/a`).request.body).toEqual({ state: 'ARMED' });

    q('alert-delete')?.click();
    http.expectOne({ method: 'DELETE', url: `${ACCOUNT}/alerts/a` }).flush(null);
  });
});
