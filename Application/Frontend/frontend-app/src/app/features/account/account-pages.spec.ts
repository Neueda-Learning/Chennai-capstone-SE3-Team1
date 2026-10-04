import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NotificationStore } from '../../core/notifications/notification.store';
import { THEME_STORAGE, ThemeService } from '../../core/theme/theme.service';
import { UserProfileStore } from '../../core/user/user-profile.store';
import { provideApi as provideAuthApi } from '../../generated/auth-client';
import { provideApi as provideTradeApi } from '../../generated/trade-client';
import { FakeApi } from '../../testing/fake-api';
import { SettingsPage } from '../settings/settings-page';
import { AccountPage } from './account-page';

const USER = { id: 'u1', username: 'priya.menon', email: 'priya@example.com', phone: null, accountId: 5, roles: ['CUSTOMER'], status: 'ACTIVE', createdOn: '2026-01-15T09:00:00Z' };
const ACCOUNT = { id: 5, accountId: 'ACC-5', holderName: 'Priya Menon', bankName: 'HDFC Bank', cashBalance: 1, status: 'ACTIVE', version: 0, lastUpdated: '' };

function providers() {
  return [
    provideRouter([]),
    provideHttpClient(),
    provideHttpClientTesting(),
    provideAuthApi({ basePath: 'http://auth.test' }),
    provideTradeApi({ basePath: 'http://trade.test' }),
    { provide: THEME_STORAGE, useValue: window.sessionStorage }
  ];
}

describe('AccountPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AccountPage], providers: providers() });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const text = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim();

  it('shows a loading note until the profile is known', () => {
    const fixture = TestBed.createComponent(AccountPage);
    fixture.detectChanges();

    expect(text(fixture.nativeElement, 'account-loading')).toContain('Loading');
  });

  it('shows the login and the trading account', () => {
    const api = new FakeApi(http).get('/auth/me', USER).get('/accounts/5', ACCOUNT);
    TestBed.inject(UserProfileStore).load(5);
    api.flush();
    const fixture = TestBed.createComponent(AccountPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(text(el, 'account-name')).toBe('Priya Menon');
    expect(text(el, 'account-email')).toBe('priya@example.com');
    expect(text(el, 'account-phone')).toBe('Not set');
    expect(text(el, 'account-roles')).toBe('CUSTOMER');
    expect(text(el, 'account-status')).toBe('ACTIVE');
    expect(text(el, 'account-since')).toContain('2026');
    expect(text(el, 'trading-account')).toContain('HDFC Bank');
    expect(text(el, 'trading-account')).toContain('ACC-5');
    expect(el.querySelector('[data-testid="avatar-placeholder"]')?.textContent?.trim()).toBe('PM');
  });

  it('sends a user with no trading account to link a bank', () => {
    const api = new FakeApi(http).get('/auth/me', { ...USER, accountId: null, phone: '9000000001' });
    TestBed.inject(UserProfileStore).load(null);
    api.flush();
    const fixture = TestBed.createComponent(AccountPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(text(el, 'no-trading-account')).toContain('Link a bank account');
    expect(text(el, 'account-phone')).toBe('9000000001');
    expect(text(el, 'account-name')).toBe('priya.menon');
  });
});

describe('SettingsPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [SettingsPage], providers: providers() });
  });

  it('switches the theme', () => {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector<HTMLButtonElement>('[data-testid="theme-dark"]')!.click();
    fixture.detectChanges();
    expect(TestBed.inject(ThemeService).theme()).toBe('dark');
    expect(el.querySelector('[data-testid="theme-dark"]')!.getAttribute('aria-checked')).toBe('true');

    el.querySelector<HTMLButtonElement>('[data-testid="theme-light"]')!.click();
    fixture.detectChanges();
    expect(TestBed.inject(ThemeService).theme()).toBe('light');
  });

  it('turns pop-ups off and on, and remembers the choice', () => {
    const store = TestBed.inject(NotificationStore);
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    const box = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-testid="popups-toggle"]')!;
    expect(box.checked).toBe(true);

    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(store.popupsEnabled()).toBe(false);
    expect(localStorage.getItem('trading-ui.notifications.popups')).toBe('off');

    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(store.popupsEnabled()).toBe(true);
    expect(localStorage.getItem('trading-ui.notifications.popups')).toBe('on');
  });
});
