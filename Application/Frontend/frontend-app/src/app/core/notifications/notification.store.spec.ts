import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { provideApi } from '../../generated/trade-client';
import { FakeApi } from '../../testing/fake-api';
import { AccountNotification, NotificationStore, notificationStyle, timeAgo } from './notification.store';

const ACCOUNT_ID = 3;

function note(id: string, overrides: Partial<AccountNotification> = {}): AccountNotification {
  return {
    id,
    kind: 'ORDER_FILLED',
    message: `message for ${id}`,
    symbol: 'RELIANCE',
    side: 'BUY',
    quantity: 1,
    price: 100,
    executedPrice: 100,
    amount: null,
    reason: null,
    occurredAt: '2026-10-02T10:00:00',
    ...overrides
  };
}

describe('NotificationStore', () => {
  let http: HttpTestingController;
  let api: FakeApi;
  let store: NotificationStore;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: 'http://trade.test' })]
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(NotificationStore);
    api = new FakeApi(http).get('/notifications', [note('a'), note('b')]);
  });

  afterEach(() => {
    store.stop();
    http.verify();
    vi.useRealTimers();
  });

  function tick(ms = 0): void {
    vi.advanceTimersByTime(ms);
    api.flush();
  }

  it('asks for the account notifications, newest-first as served, with a limit', () => {
    store.start(ACCOUNT_ID);
    tick();

    expect(api.requested[0]).toBe('GET http://trade.test/api/v1/accounts/3/notifications?limit=30');
    expect(store.items().map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('treats the history as read on a browser that has never seen this account', () => {
    store.start(ACCOUNT_ID);
    tick();

    expect(store.unreadCount()).toBe(0);
    expect(store.toasts()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('trading-ui.notifications.read.3')!)).toEqual(['a', 'b']);
  });

  it('counts as unread whatever happened since the last visit, without popping it up', () => {
    localStorage.setItem('trading-ui.notifications.read.3', JSON.stringify(['a']));

    store.start(ACCOUNT_ID);
    tick();

    expect(store.unreadCount()).toBe(1);
    expect(store.isRead('a')).toBe(true);
    expect(store.isRead('b')).toBe(false);
    expect(store.toasts()).toHaveLength(0);
  });

  it('pops up each new notification once, oldest of the new first so the newest ends on top', () => {
    store.start(ACCOUNT_ID);
    tick();

    api.set('/notifications', [note('d'), note('c'), note('a'), note('b')]);
    tick(10_000);

    expect(store.toasts().map((t) => t.id)).toEqual(['c', 'd']);
    expect(store.unreadCount()).toBe(2);

    tick(10_000);
    expect(store.toasts()).toEqual([]);
  });

  it('does not pop up something already read', () => {
    store.start(ACCOUNT_ID);
    tick();
    store.markRead('c');

    api.set('/notifications', [note('c'), note('a'), note('b')]);
    tick(10_000);

    expect(store.toasts()).toHaveLength(0);
  });

  it('keeps at most four pop-ups on screen', () => {
    store.start(ACCOUNT_ID);
    tick();

    api.set('/notifications', ['n6', 'n5', 'n4', 'n3', 'n2', 'n1'].map((id) => note(id)).concat([note('a'), note('b')]));
    tick(10_000);

    expect(store.toasts()).toHaveLength(4);
    expect(store.toasts().at(-1)!.id).toBe('n6');
  });

  it('dismisses a pop-up on request, and by itself after its lifetime', () => {
    store.start(ACCOUNT_ID);
    tick();
    api.set('/notifications', [note('d'), note('c'), note('a'), note('b')]);
    tick(10_000);

    store.dismissToast('c');
    expect(store.toasts().map((t) => t.id)).toEqual(['d']);

    vi.advanceTimersByTime(7_000);
    expect(store.toasts()).toHaveLength(0);
  });

  it('marks everything read, and remembers it', () => {
    localStorage.setItem('trading-ui.notifications.read.3', '[]');
    store.start(ACCOUNT_ID);
    tick();
    expect(store.unreadCount()).toBe(2);

    store.markAllRead();

    expect(store.unreadCount()).toBe(0);
    expect(JSON.parse(localStorage.getItem('trading-ui.notifications.read.3')!)).toEqual(['a', 'b']);
  });

  it('keeps the last good list and says it failed when a poll fails, then recovers', () => {
    store.start(ACCOUNT_ID);
    tick();

    api.set('/notifications', { errorCode: 'X', message: 'down' }, 500);
    tick(10_000);
    expect(store.failed()).toBe(true);
    expect(store.items()).toHaveLength(2);

    api.set('/notifications', [note('a'), note('b')]);
    tick(10_000);
    expect(store.failed()).toBe(false);
  });

  it('polls on its interval until stopped, and forgets everything when stopped', () => {
    store.start(ACCOUNT_ID);
    tick();
    tick(10_000);
    tick(10_000);
    expect(api.count('/notifications')).toBe(3);

    store.stop();
    vi.advanceTimersByTime(60_000);
    api.flush();

    expect(api.count('/notifications')).toBe(3);
    expect(store.items()).toEqual([]);
    expect(store.unreadCount()).toBe(0);
  });

  it('starting the same account twice does not double the polling', () => {
    store.start(ACCOUNT_ID);
    store.start(ACCOUNT_ID);
    tick();

    expect(api.count('/notifications')).toBe(1);
  });

  it('switching account cancels the old poll and starts clean', () => {
    store.start(ACCOUNT_ID);
    vi.advanceTimersByTime(0);
    const late = http.expectOne((r) => r.url.endsWith('/accounts/3/notifications'));
    store.start(4);
    expect(late.cancelled).toBe(true);
    tick();

    expect(store.items().map((n) => n.id)).toEqual(['a', 'b']);
    expect(api.requested.some((r) => r.includes('/accounts/4/notifications'))).toBe(true);
  });

  it('keeps filling the bell but stops popping up when pop-ups are switched off', () => {
    store.setPopupsEnabled(false);
    store.start(ACCOUNT_ID);
    tick();
    api.set('/notifications', [note('d'), note('a'), note('b')]);
    tick(10_000);

    expect(store.toasts()).toEqual([]);
    expect(store.items().map((n) => n.id)).toEqual(['d', 'a', 'b']);
    expect(store.unreadCount()).toBe(1);
  });

  it('clears pop-ups already showing when they are switched off, and remembers the setting', () => {
    store.start(ACCOUNT_ID);
    tick();
    api.set('/notifications', [note('d'), note('a'), note('b')]);
    tick(10_000);
    expect(store.toasts()).toHaveLength(1);

    store.setPopupsEnabled(false);

    expect(store.toasts()).toEqual([]);
    expect(localStorage.getItem('trading-ui.notifications.popups')).toBe('off');
  });

  it('counts a poll that found something new as a change, but not the first poll', () => {
    store.start(ACCOUNT_ID);
    tick();
    expect(store.changes()).toBe(0);

    tick(10_000);
    expect(store.changes()).toBe(0);

    api.set('/notifications', [note('d'), note('a'), note('b')]);
    tick(10_000);
    expect(store.changes()).toBe(1);
  });

  it('refresh() polls immediately instead of waiting for the next tick', () => {
    store.start(ACCOUNT_ID);
    tick();

    store.refresh();
    api.flush();

    expect(api.count('/notifications')).toBe(2);
  });

  it('refresh() before anything is started does nothing', () => {
    expect(() => store.refresh()).not.toThrow();
  });
});

describe('notificationStyle', () => {
  it('gives every kind an icon and a tone', () => {
    const kinds = ['ORDER_PLACED', 'ORDER_FILLED', 'ORDER_REJECTED', 'ORDER_CANCELLED', 'TRANSFER_IN', 'TRANSFER_OUT'] as const;
    for (const kind of kinds) {
      const style = notificationStyle(kind);
      expect(style.icon).toMatch(/^bi-/);
      expect(['success', 'danger', 'warning', 'info']).toContain(style.tone);
    }
    expect(notificationStyle('ORDER_FILLED').tone).toBe('success');
    expect(notificationStyle('ORDER_REJECTED').tone).toBe('danger');
  });
});

describe('timeAgo', () => {
  const now = new Date(2026, 9, 2, 12, 0, 0).getTime();
  const at = (msAgo: number) => {
    const d = new Date(now - msAgo);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  it('reads naturally at each scale', () => {
    expect(timeAgo(at(20_000), now)).toBe('just now');
    expect(timeAgo(at(60_000), now)).toBe('1 min ago');
    expect(timeAgo(at(5 * 60_000), now)).toBe('5 mins ago');
    expect(timeAgo(at(3600_000), now)).toBe('1 hour ago');
    expect(timeAgo(at(7 * 3600_000), now)).toBe('7 hours ago');
  });

  it('falls back to the date after a day, and to nothing for garbage', () => {
    expect(timeAgo(at(3 * 24 * 3600_000), now)).toMatch(/\d{4}/);
    expect(timeAgo('garbage', now)).toBe('');
  });

  it('never goes negative when the server clock is ahead', () => {
    expect(timeAgo(at(-30_000), now)).toBe('just now');
  });
});
