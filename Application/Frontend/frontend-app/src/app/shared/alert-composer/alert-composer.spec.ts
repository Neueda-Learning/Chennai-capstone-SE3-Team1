import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideApi } from '../../generated/trade-client';
import { SessionStore } from '../../core/auth/session.store';
import { PriceAlert } from '../../core/services/watchlist.service';
import { WatchlistStore } from '../../core/watchlists/watchlist.store';
import { AlertComposer } from './alert-composer';

const BASE = 'http://trade.test/api/v1/accounts/42';
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
  imports: [AlertComposer],
  template: `<tui-alert-composer [symbol]="symbol()" [currentPrice]="price()" [(markerMode)]="markerMode" [(pendingPrice)]="pending" />`
})
class Host {
  readonly symbol = signal('TCS');
  readonly price = signal<number | null>(3000);
  readonly markerMode = signal(false);
  readonly pending = signal<number | null>(null);
}

describe('AlertComposer', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let http: HttpTestingController;
  let store: WatchlistStore;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string): T | null => root().querySelector<T>(`[data-testid="${id}"]`);
  const text = (id: string): string => (q(id)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function setUp(alerts: PriceAlert[] = []): Promise<void> {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: 'http://trade.test' })]
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).signIn(TOKEN, null, null);
    store = TestBed.inject(WatchlistStore);
    store.start();
    http.expectOne(`${BASE}/watchlists`).flush([]);
    http.expectOne(`${BASE}/alerts`).flush(alerts);
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await settle();
  }

  async function type(value: string): Promise<void> {
    const box = q<HTMLInputElement>('composer-price') as HTMLInputElement;
    box.value = value;
    box.dispatchEvent(new Event('input'));
    await settle();
  }

  afterEach(() => {
    store?.stop();
    http?.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('turning marker mode on and off', () => {
    it('starts with just the button and a note that there are no alerts', async () => {
      await setUp();

      expect(q('marker-toggle')).not.toBeNull();
      expect(q('composer-form')).toBeNull();
      expect(text('composer-none')).toContain('No alerts on TCS');
    });

    it('toggles marker mode, and explains what to do', async () => {
      await setUp();

      q('marker-toggle')?.click();
      await settle();

      expect(host.markerMode()).toBe(true);
      expect(q('marker-toggle')?.getAttribute('aria-pressed')).toBe('true');
      expect(text('marker-hint')).toContain('Click the chart');

      q('marker-toggle')?.click();
      await settle();
      expect(host.markerMode()).toBe(false);
      expect(q('marker-hint')).toBeNull();
    });

    it('drops a half-placed marker when marker mode is switched off', async () => {
      await setUp();
      host.markerMode.set(true);
      host.pending.set(3200);
      await settle();

      q('marker-toggle')?.click();
      await settle();

      expect(host.pending()).toBeNull();
    });
  });

  describe('confirming a marker from the chart', () => {
    it('shows the price in the box, the direction it implies, and how far it is from now', async () => {
      await setUp();

      host.pending.set(3150);
      await settle();

      expect((q<HTMLInputElement>('composer-price') as HTMLInputElement).value).toBe('3150.00');
      expect(text('composer-direction')).toBe('rises to or above');
      expect(q('composer-direction')?.getAttribute('data-direction')).toBe('ABOVE');
      expect(text('composer-distance')).toContain('+5.00%');
    });

    it('waits for a fall when the marker is below the current price', async () => {
      await setUp();

      host.pending.set(2850);
      await settle();

      expect(text('composer-direction')).toBe('falls to or below');
      expect(text('composer-distance')).toContain('-5.00%');
    });

    it('sets the alert with the direction worked out from the marker, then confirms and resets', async () => {
      await setUp();
      host.markerMode.set(true);
      host.pending.set(2850);
      await settle();

      q('composer-confirm')?.click();
      const request = http.expectOne(`${BASE}/alerts`);
      expect(request.request.body).toEqual({ symbol: 'TCS', threshold: 2850, direction: 'BELOW' });
      request.flush(alert('new', { threshold: 2850, direction: 'BELOW' }));
      await settle();

      expect(text('composer-done')).toContain('falls to');
      expect(text('composer-done')).toContain('2,850.00');
      expect(host.pending()).toBeNull();
      expect(host.markerMode()).toBe(false);
      expect(q('composer-form')).toBeNull();
      expect(q('composer-alert-new')).not.toBeNull();
    });

    it('cancels without creating anything', async () => {
      await setUp();
      host.pending.set(3200);
      await settle();

      q('composer-cancel')?.click();
      await settle();

      expect(host.pending()).toBeNull();
      expect(q('composer-form')).toBeNull();
    });

    it('keeps the marker and says why when the alert is refused', async () => {
      await setUp();
      host.pending.set(3200);
      await settle();

      q('composer-confirm')?.click();
      http.expectOne(`${BASE}/alerts`).flush({ errorCode: 'WLT-429', message: 'x' }, { status: 429, statusText: 'Too Many' });
      await settle();

      expect(text('composer-error')).toContain('25 alerts');
      expect(host.pending()).toBe(3200);
      expect(q('composer-form')).not.toBeNull();
    });

    it('disables the button while the alert is being set, so it cannot be set twice', async () => {
      await setUp();
      host.pending.set(3200);
      await settle();

      q('composer-confirm')?.click();
      await settle();
      expect((q<HTMLButtonElement>('composer-confirm') as HTMLButtonElement).disabled).toBe(true);
      http.expectOne(`${BASE}/alerts`).flush(alert('n'));
    });
  });

  describe('typing a price instead', () => {
    it('opens the form at the current price and moves the marker as a price is typed', async () => {
      await setUp();

      q('by-price')?.click();
      await settle();
      expect(host.pending()).toBe(3000);

      await type('3333.5');
      expect(host.pending()).toBe(3333.5);
      expect(text('composer-direction')).toBe('rises to or above');
    });

    it('does not move the marker for text that is not a positive price, and refuses to set it', async () => {
      await setUp();
      host.pending.set(3100);
      await settle();

      await type('-4');
      expect(host.pending()).toBe(3100);
      await type('');
      q('composer-confirm')?.click();
      await settle();

      expect(text('composer-error')).toContain('greater than zero');
      http.expectNone(`${BASE}/alerts`);
    });

    it('rounds a typed price to the paisa', async () => {
      await setUp();
      host.pending.set(3100);
      await settle();
      await type('3200.456');

      q('composer-confirm')?.click();

      expect(http.expectOne(`${BASE}/alerts`).request.body.threshold).toBe(3200.46);
    });

    it('sets the alert when Enter is pressed in the box', async () => {
      await setUp();
      host.pending.set(3100);
      await settle();

      (q('composer-price') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      http.expectOne(`${BASE}/alerts`);
    });

    it('has quick levels a few per cent either side of the current price', async () => {
      await setUp();
      host.pending.set(3100);
      await settle();

      q('quick--5')?.click();
      await settle();
      expect(host.pending()).toBe(2850);

      q('quick-2')?.click();
      await settle();
      expect(host.pending()).toBe(3060);
    });

    it('still lets a price be typed when there is no current price, and offers no quick levels', async () => {
      await setUp();
      host.price.set(null);
      await settle();

      q('by-price')?.click();
      await settle();
      expect(q('composer-form')).not.toBeNull();
      expect(q('quick-2')).toBeNull();

      await type('1234');
      expect(host.pending()).toBe(1234);
      q('composer-confirm')?.click();
      expect(http.expectOne(`${BASE}/alerts`).request.body).toEqual({ symbol: 'TCS', threshold: 1234, direction: 'ABOVE' });
    });
  });

  describe("this stock's existing alerts", () => {
    it('lists only alerts for the stock on show, with the way each waits and its state', async () => {
      await setUp([alert('a', { threshold: 3500 }), alert('b', { symbol: 'INFY' }), alert('c', { threshold: 2800, direction: 'BELOW', state: 'FIRED' })]);

      expect(q('composer-alert-a')).not.toBeNull();
      expect(q('composer-alert-b')).toBeNull();
      expect(text('composer-alert-a')).toContain('3,500.00');
      expect(text('composer-alert-a')).toContain('Watching');
      expect(text('composer-alert-c')).toContain('Triggered');
      expect(q('composer-none')).toBeNull();
    });

    it('turns an alert off, and back on', async () => {
      await setUp([alert('a')]);

      (q('composer-alert-a')?.querySelector('[data-testid="composer-alert-toggle"]') as HTMLElement).click();
      const off = http.expectOne(`${BASE}/alerts/a`);
      expect(off.request.body).toEqual({ state: 'DISABLED' });
      off.flush(alert('a', { state: 'DISABLED' }));
      await settle();
      expect(text('composer-alert-a')).toContain('Off');

      (q('composer-alert-a')?.querySelector('[data-testid="composer-alert-toggle"]') as HTMLElement).click();
      expect(http.expectOne(`${BASE}/alerts/a`).request.body).toEqual({ state: 'ARMED' });
    });

    it('deletes an alert', async () => {
      await setUp([alert('a')]);

      (q('composer-alert-a')?.querySelector('[data-testid="composer-alert-delete"]') as HTMLElement).click();
      http.expectOne(`${BASE}/alerts/a`).flush(null);
      await settle();

      expect(q('composer-alert-a')).toBeNull();
      expect(q('composer-none')).not.toBeNull();
    });
  });

  it('drops a half-placed marker when the stock on show changes: it belonged to the last one', async () => {
    await setUp();
    host.pending.set(3200);
    await settle();

    host.symbol.set('INFY');
    await settle();

    expect(host.pending()).toBeNull();
    expect(text('composer-none')).toContain('No alerts on INFY');
  });
});
