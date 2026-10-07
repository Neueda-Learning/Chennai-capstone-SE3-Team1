import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { bearerInterceptor } from './core/auth/bearer.interceptor';
import { SessionStore } from './core/auth/session.store';
import { NotificationStore } from './core/notifications/notification.store';
import { Shell } from './core/layout/shell';
import { THEME_STORAGE } from './core/theme/theme.service';
import { provideApi as provideAuthApi } from './generated/auth-client';
import { provideApi as provideTradeApi } from './generated/trade-client';
import { SettingsPage } from './features/settings/settings-page';
import { PortfolioPage } from './features/portfolio/portfolio-page';
import { WatchlistsPage } from './features/watchlists/watchlists-page';
import { AdvicePage } from './features/advice/advice-page';

const appChildren = (): Route[] => routes.find((route) => route.path === 'app')?.children ?? [];
const child = (path: string): Route | undefined => appChildren().find((route) => route.path === path);

describe('The four Sprint 10 modules are reachable from the Angular application', () => {
  it('serves Portfolio, Watchlists and Settings behind the signed-in shell', () => {
    const app = routes.find((route) => route.path === 'app');
    expect(app?.canActivate?.length).toBeGreaterThan(0);
    expect(app?.canActivateChild?.length).toBeGreaterThan(0);

    for (const path of ['portfolio', 'watchlists', 'settings', 'advice']) {
      expect(child(path)?.loadComponent, `/app/${path} has no page`).toBeTypeOf('function');
    }
  });

  it('loads the page each module route points at', async () => {
    expect(await child('portfolio')?.loadComponent?.()).toBe(PortfolioPage);
    expect(await child('watchlists')?.loadComponent?.()).toBe(WatchlistsPage);
    expect(await child('settings')?.loadComponent?.()).toBe(SettingsPage);
    expect(await child('advice')?.loadComponent?.()).toBe(AdvicePage);
  });

  it('sends the short paths a customer might type to the page under /app', () => {
    for (const path of ['portfolio', 'watchlists', 'settings', 'advice']) {
      const redirect = routes.find((route) => route.path === path);
      expect(redirect?.redirectTo).toBe(`app/${path}`);
    }
  });

  describe('on the Settings page', () => {
    const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';

    afterEach(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    it('shows the preferences card and the notification history, each asking the Trade API for the signed-in account', () => {
      TestBed.configureTestingModule({
        imports: [SettingsPage],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideTradeApi({ basePath: 'http://trade.test' }),
          { provide: THEME_STORAGE, useValue: window.sessionStorage },
          { provide: NotificationStore, useValue: { popupsEnabled: signal(true), setPopupsEnabled: vi.fn() } }
        ]
      });
      TestBed.inject(SessionStore).signIn(TOKEN, null, null);
      const http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(SettingsPage);
      fixture.detectChanges();

      const page = fixture.nativeElement as HTMLElement;
      expect(page.querySelector('[data-testid="preferences-card"]')).not.toBeNull();
      expect(page.querySelector('tui-notification-history-card')).not.toBeNull();
      http.expectOne('http://trade.test/api/v1/accounts/42/preferences').flush({}, { status: 404, statusText: 'Not Found' });
      http.expectOne((r) => r.url === 'http://trade.test/api/v1/accounts/42/notification-history').flush([]);
      http.verify();
    });
  });

  describe('from the shell', () => {
    beforeEach(async () => {
      sessionStorage.clear();
      localStorage.clear();
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
    });

    const hrefs = (selector: string): (string | null)[] => {
      const fixture = TestBed.createComponent(Shell);
      fixture.detectChanges();
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(selector)).map((el) =>
        el.getAttribute('href')
      );
    };

    it('links Portfolio and Watchlists in the sidebar', () => {
      const links = hrefs('.sidebar-menu-link');
      expect(links).toContain('/app/portfolio');
      expect(links).toContain('/app/watchlists');
    });

    it('links Settings, which holds Preferences and Notification History, from the profile menu', () => {
      expect(hrefs('[data-testid="menu-settings"]')).toEqual(['/settings']);
    });
  });
});
