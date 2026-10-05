import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { provideApi as provideAuthApi } from '../../generated/auth-client';
import { provideApi as provideTradeApi } from '../../generated/trade-client';
import { FakeApi } from '../../testing/fake-api';
import { bearerInterceptor } from '../auth/bearer.interceptor';
import { SessionStore } from '../auth/session.store';
import { NotificationStore } from '../notifications/notification.store';
import { THEME_STORAGE } from '../theme/theme.service';
import { Shell } from './shell';

const ACCOUNT_ID = 5;

const USER = {
  id: 'u-1',
  username: 'priya.menon',
  email: 'priya.menon@example.com',
  phone: null,
  accountId: ACCOUNT_ID,
  roles: ['CUSTOMER'],
  status: 'ACTIVE'
};

const ACCOUNT = {
  id: ACCOUNT_ID,
  accountId: 'ACC-000005',
  holderName: 'Priya Menon',
  bankName: 'HDFC Bank',
  cashBalance: 100,
  status: 'ACTIVE',
  version: 0,
  lastUpdated: '2026-02-14T10:15:30Z'
};

function localIso(msAgo: number): string {
  const d = new Date(Date.now() - msAgo);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const NOTES = [
  { id: 'order-1-FILLED', kind: 'ORDER_FILLED', message: 'Order filled: BUY 10 RELIANCE @ 1300.00', symbol: 'RELIANCE', side: 'BUY', quantity: 10, price: 1300, executedPrice: 1300, amount: null, reason: null, occurredAt: localIso(5 * 60_000) },
  { id: 'transfer-1', kind: 'TRANSFER_IN', message: 'Wallet funded: +10000.00 INR', symbol: null, side: null, quantity: null, price: null, executedPrice: null, amount: 10000, reason: null, occurredAt: localIso(3 * 3600_000) }
];

describe('Shell', () => {
  let http: HttpTestingController;
  let api: FakeApi;
  let notes: unknown[];

  beforeEach(async () => {
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
    document.documentElement.removeAttribute('data-bs-theme');
    notes = NOTES;

    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([bearerInterceptor])),
        provideHttpClientTesting(),
        provideAuthApi({ basePath: 'http://auth.test' }),
        provideTradeApi({ basePath: 'http://trade.test' }),
        { provide: THEME_STORAGE, useValue: window.sessionStorage }
      ]
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    api = new FakeApi(http)
      .get('/auth/me', USER)
      .get(`/accounts/${ACCOUNT_ID}`, ACCOUNT)
      .on((r) => r.request.url.endsWith(`/accounts/${ACCOUNT_ID}/notifications`), null)
      .on((r) => r.request.method === 'POST' && r.request.url.endsWith('/auth/logout'), {});
    api.on((r) => r.request.url.endsWith(`/accounts/${ACCOUNT_ID}/notifications`), NOTES);
  });

  afterEach(() => {
    http?.verify();
    TestBed.inject(NotificationStore).stop();
    vi.useRealTimers();
  });

  function signInAndCreate(accountId: number | null = ACCOUNT_ID): ComponentFixture<Shell> {
    TestBed.inject(SessionStore).signIn('token', accountId, 'refresh-token-1');
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    settle(fixture);
    return fixture;
  }

  function settle(fixture: ComponentFixture<Shell>): void {
    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    api.flush();
    fixture.detectChanges();
  }

  const root = (fixture: ComponentFixture<Shell>) => fixture.nativeElement as HTMLElement;
  const one = (fixture: ComponentFixture<Shell>, selector: string) => root(fixture).querySelector(selector);
  const textOf = (fixture: ComponentFixture<Shell>, selector: string) => one(fixture, selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('should create', () => {
    const fixture = TestBed.createComponent(Shell);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('is branded YRVTrading in the sidebar and the footer', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    expect(textOf(fixture, '.sidebar-brand')).toBe('YRVTrading');
    expect(textOf(fixture, '.footer-logo')).toBe('YRVTrading');
    expect(root(fixture).textContent).not.toContain('Trading UI');
  });

  it('should render the five navigation links', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const links = Array.from(root(fixture).querySelectorAll('.sidebar-menu-link')).map((el) => el.textContent?.trim());
    expect(links).toEqual(['Dashboard', 'Portfolio', 'Market & Trade', 'Blotter', 'Bank Account Details']);
  });

  it('links each entry straight to its page under /app', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const hrefs = Array.from(root(fixture).querySelectorAll('.sidebar-menu-link')).map((el) => el.getAttribute('href'));
    expect(hrefs).toEqual(['/app/dashboard', '/app/portfolio', '/app/orders', '/app/blotter', '/app/bank-accounts']);
  });

  it('highlights the entry for the page being shown, and only that one', async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    const activeLabels = () =>
      Array.from(root(fixture).querySelectorAll('.sidebar-menu-link.active')).map((el) => el.textContent?.trim());

    for (const [url, label] of [
      ['/app/dashboard', 'Dashboard'],
      ['/app/portfolio', 'Portfolio'],
      ['/app/orders', 'Market & Trade'],
      ['/app/blotter', 'Blotter'],
      ['/app/bank-accounts', 'Bank Account Details']
    ]) {
      await router.navigateByUrl(url);
      fixture.detectChanges();
      expect(activeLabels()).toEqual([label]);
    }
  });

  it('should open the mobile sidebar on toggle', () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    root(fixture).querySelector<HTMLButtonElement>('.sidebar-toggle-btn')?.click();
    fixture.detectChanges();

    expect(one(fixture, '.sidebar-wrapper')?.classList.contains('show')).toBe(true);
  });

  describe('who is signed in', () => {
    it("shows the account holder's name and the login's email, not a demo user", () => {
      const fixture = signInAndCreate();

      expect(textOf(fixture, '[data-testid="sidebar-name"]')).toBe('Priya Menon');
      expect(textOf(fixture, '[data-testid="sidebar-email"]')).toBe('priya.menon@example.com');
      expect(textOf(fixture, '[data-testid="navbar-name"]')).toBe('Priya Menon');
      expect(root(fixture).textContent).not.toContain('Demo Trader');
      expect(root(fixture).textContent).not.toContain('trader@example.com');
    });

    it('greets them by name in the profile menu', () => {
      const fixture = signInAndCreate();

      expect(textOf(fixture, '.dropdown-menu-profile .dropdown-header')).toContain('Welcome, Priya Menon!');
      expect(textOf(fixture, '.dropdown-menu-profile .dropdown-header')).toContain('priya.menon@example.com');
    });

    it('keeps a long single-token name inside the profile menu instead of spilling past it', () => {
      api.set('/auth/me', { ...USER, username: 'sharma.singhania' });
      api.set(`/accounts/${ACCOUNT_ID}`, { ...ACCOUNT, holderName: 'Sharma.Singhania' });
      const fixture = signInAndCreate();

      expect(textOf(fixture, '[data-testid="navbar-name"]')).toBe('Sharma.Singhania');
      expect(textOf(fixture, '.dropdown-menu-profile .dropdown-header')).toContain('Welcome, Sharma.Singhania!');
    });

    it('falls back to the username when no bank account is linked, so there is no holder name', () => {
      const fixture = signInAndCreate(null);

      expect(textOf(fixture, '[data-testid="sidebar-name"]')).toBe('priya.menon');
      expect(api.count('/accounts/')).toBe(0);
    });

    it('draws a placeholder avatar with their initials, as no picture exists', () => {
      const fixture = signInAndCreate();

      expect(one(fixture, '.sidebar-profile [data-testid="avatar-placeholder"]')?.textContent?.trim()).toBe('PM');
      expect(one(fixture, '.navbar-profile-btn [data-testid="avatar-placeholder"]')?.textContent?.trim()).toBe('PM');
      expect(one(fixture, '.sidebar-profile img')).toBeNull();
    });

    it('draws a generic silhouette before anything is known, and says "Trader"', () => {
      const fixture = TestBed.createComponent(Shell);
      fixture.detectChanges();

      expect(one(fixture, '.sidebar-profile [data-testid="avatar-placeholder"] .bi-person-fill')).not.toBeNull();
      expect(textOf(fixture, '[data-testid="sidebar-name"]')).toBe('Trader');
    });

    it('still works when the profile cannot be loaded', () => {
      api.set('/auth/me', { errorCode: 'X', message: 'down' }, 500);
      api.set(`/accounts/${ACCOUNT_ID}`, { errorCode: 'X', message: 'down' }, 500);
      const fixture = signInAndCreate();

      expect(textOf(fixture, '[data-testid="sidebar-name"]')).toBe('Trader');
    });
  });

  describe('signing out', () => {
    it('signs out, clears the session and navigates to the login page', () => {
      const fixture = signInAndCreate();
      const session = TestBed.inject(SessionStore);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      expect(session.isSignedIn()).toBe(true);
      let logoutAuthHeader: string | null = null;
      api.on((r) => {
        const hit = r.request.method === 'POST' && r.request.url.endsWith('/auth/logout');
        if (hit) {
          logoutAuthHeader = r.request.headers.get('Authorization');
        }
        return hit;
      }, {});

      root(fixture).querySelector<HTMLButtonElement>('[data-testid="logout"]')!.click();
      fixture.detectChanges();
      settle(fixture);

      expect(api.requested).toContain('POST http://auth.test/auth/logout');
      expect(logoutAuthHeader).toBe('Bearer token');
      expect(session.isSignedIn()).toBe(false);
      expect(session.accessToken()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it('still signs out locally when the revoke call is refused', () => {
      const fixture = signInAndCreate();
      const session = TestBed.inject(SessionStore);
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      api.on((r) => r.request.method === 'POST' && r.request.url.endsWith('/auth/logout'), { errorCode: 'AUTH-401' }, 401);

      root(fixture).querySelector<HTMLButtonElement>('[data-testid="logout"]')!.click();
      fixture.detectChanges();
      settle(fixture);

      expect(session.isSignedIn()).toBe(false);
    });

    it('forgets who was signed in and stops polling for notifications', () => {
      const fixture = signInAndCreate();
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const before = api.count('/notifications');

      root(fixture).querySelector<HTMLButtonElement>('[data-testid="logout"]')!.click();
      fixture.detectChanges();
      settle(fixture);
      vi.advanceTimersByTime(60_000);
      settle(fixture);

      expect(textOf(fixture, '[data-testid="sidebar-name"]')).toBe('Trader');
      expect(api.count('/notifications')).toBe(before);
    });
  });

  describe('notifications', () => {
    it('lists the real ones, with their age', () => {
      const fixture = signInAndCreate();

      const items = Array.from(root(fixture).querySelectorAll('[data-testid="notification-item"]')).map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');
      expect(items).toHaveLength(2);
      expect(items[0]).toContain('Order filled: BUY 10 RELIANCE @ 1300.00');
      expect(items[0]).toContain('5 mins ago');
      expect(items[1]).toContain('Wallet funded');
      expect(items[1]).toContain('3 hours ago');
    });

    it('contains none of the old placeholder notifications', () => {
      notes = [];
      api.on((r) => r.request.url.endsWith('/notifications'), []);
      const fixture = signInAndCreate();

      const bell = textOf(fixture, '.dropdown-menu-notification');
      expect(bell).not.toContain('SELL 5 INFY');
      expect(bell).not.toContain('2 mins ago');
      expect(bell).not.toContain('View all notifications');
    });

    it('does not badge the bell for history the user has never seen on this browser', () => {
      const fixture = signInAndCreate();

      expect(one(fixture, '[data-testid="notification-badge"]')).toBeNull();
    });

    it('badges the bell, counts the unread, and clears them on "Mark all read"', () => {
      localStorage.setItem('trading-ui.notifications.read.5', JSON.stringify(['something-old']));
      const fixture = signInAndCreate();

      expect(one(fixture, '[data-testid="notification-badge"]')).not.toBeNull();
      expect(textOf(fixture, '[data-testid="notification-count"]')).toBe('2');

      root(fixture).querySelector<HTMLButtonElement>('[data-testid="mark-all-read"]')!.click();
      fixture.detectChanges();

      expect(one(fixture, '[data-testid="notification-badge"]')).toBeNull();
      expect(one(fixture, '[data-testid="notification-count"]')).toBeNull();
      expect(JSON.parse(localStorage.getItem('trading-ui.notifications.read.5')!)).toEqual(expect.arrayContaining(['order-1-FILLED', 'transfer-1']));
    });

    it('marks one read when it is clicked', () => {
      localStorage.setItem('trading-ui.notifications.read.5', JSON.stringify(['something-old']));
      const fixture = signInAndCreate();

      root(fixture).querySelector<HTMLButtonElement>('[data-testid="notification-item"]')!.click();
      fixture.detectChanges();

      expect(textOf(fixture, '[data-testid="notification-count"]')).toBe('1');
    });

    it('explains an empty list, and why for an account that is not linked', () => {
      api.on((r) => r.request.url.endsWith('/notifications'), []);
      const linked = signInAndCreate();
      expect(textOf(linked, '[data-testid="notification-empty"]')).toContain('Nothing yet');
    });

    it('says a bank account needs linking when there is no account to notify about', () => {
      const fixture = signInAndCreate(null);

      expect(textOf(fixture, '[data-testid="notification-empty"]')).toContain('Link a bank account');
    });
  });

  describe('pop-ups', () => {
    it('shows a pop-up bottom right for a notification that arrives while the app is open', () => {
      const fixture = signInAndCreate();
      expect(root(fixture).querySelectorAll('[data-testid="toast"]')).toHaveLength(0);

      api.on((r) => r.request.url.endsWith('/notifications'), [
        { ...NOTES[0], id: 'order-2-FILLED', message: 'Order filled: SELL 5 INFY @ 1450.00' },
        ...NOTES
      ]);
      vi.advanceTimersByTime(10_000);
      fixture.detectChanges();
      settle(fixture);

      const toasts = Array.from(root(fixture).querySelectorAll('[data-testid="toast"]'));
      expect(toasts).toHaveLength(1);
      expect(toasts[0].textContent).toContain('Order filled: SELL 5 INFY @ 1450.00');
      expect(one(fixture, '.toast-stack')).not.toBeNull();
    });

    it('does not pop up again for one it already announced', () => {
      const fixture = signInAndCreate();
      api.on((r) => r.request.url.endsWith('/notifications'), [{ ...NOTES[0], id: 'order-2-FILLED' }, ...NOTES]);

      vi.advanceTimersByTime(10_000);
      fixture.detectChanges();
      settle(fixture);
      root(fixture).querySelector<HTMLButtonElement>('.toast-close')!.click();
      fixture.detectChanges();
      vi.advanceTimersByTime(10_000);
      fixture.detectChanges();
      settle(fixture);

      expect(root(fixture).querySelectorAll('[data-testid="toast"]')).toHaveLength(0);
    });

    it('dismisses itself after a few seconds', () => {
      const fixture = signInAndCreate();
      api.on((r) => r.request.url.endsWith('/notifications'), [{ ...NOTES[0], id: 'order-2-FILLED' }, ...NOTES]);
      vi.advanceTimersByTime(10_000);
      fixture.detectChanges();
      settle(fixture);
      expect(root(fixture).querySelectorAll('[data-testid="toast"]')).toHaveLength(1);

      vi.advanceTimersByTime(8_000);
      fixture.detectChanges();

      expect(root(fixture).querySelectorAll('[data-testid="toast"]')).toHaveLength(0);
    });
  });

  describe('search and the profile menu', () => {
    it('has a working search box, not a dead one', () => {
      const fixture = TestBed.createComponent(Shell);
      fixture.detectChanges();

      expect(root(fixture).querySelector('tui-navbar-search [data-testid="search-input"]')).not.toBeNull();
    });

    it('links My Account and Settings to real pages', () => {
      const fixture = TestBed.createComponent(Shell);
      fixture.detectChanges();

      expect(root(fixture).querySelector('[data-testid="menu-account"]')?.getAttribute('href')).toBe('/account');
      expect(root(fixture).querySelector('[data-testid="menu-settings"]')?.getAttribute('href')).toBe('/settings');
      expect(root(fixture).querySelector('a[href="javascript:void(0)"]')).toBeNull();
    });
  });

  describe('dark mode', () => {
    it('offers a toggle that flips the theme on <html>', () => {
      const fixture = TestBed.createComponent(Shell);
      fixture.detectChanges();
      const toggle = root(fixture).querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]')!;
      expect(toggle).not.toBeNull();
      const before = document.documentElement.getAttribute('data-bs-theme');

      toggle.click();
      fixture.detectChanges();

      const after = document.documentElement.getAttribute('data-bs-theme');
      expect(after).not.toBe(before);
      expect(['light', 'dark']).toContain(after);
    });
  });
});
