import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SessionStore } from '../../core/auth/session.store';
import { NotificationStore } from '../../core/notifications/notification.store';
import { THEME_STORAGE } from '../../core/theme/theme.service';
import { provideApi } from '../../generated/trade-client';
import { SettingsPage } from './settings-page';

const URL = 'http://trade.test/api/v1/accounts/42/preferences';
const HISTORY_URL = 'http://trade.test/api/v1/accounts/42/notification-history';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';

describe('SettingsPage alert delivery', () => {
  let http: HttpTestingController;

  function setUp(): ComponentFixture<SettingsPage> {
    TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: 'http://trade.test' }),
        { provide: THEME_STORAGE, useValue: window.sessionStorage },
        { provide: NotificationStore, useValue: { popupsEnabled: signal(true), setPopupsEnabled: vi.fn() } }
      ]
    });
    TestBed.inject(SessionStore).signIn(TOKEN, null, null);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    http.expectOne((request) => request.url === HISTORY_URL).flush([]);
    fixture.detectChanges();
    return fixture;
  }

  function el(fixture: ComponentFixture<SettingsPage>, testId: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  afterEach(() => {
    http?.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows the saved channel and the default account', () => {
    const fixture = setUp();
    http.expectOne(URL).flush({ accountId: 42, defaultAccountId: 42, channel: 'PUSH', updatedAt: '2026-10-06T10:15:30' });
    fixture.detectChanges();

    expect(el(fixture, 'channel-PUSH')?.getAttribute('aria-checked')).toBe('true');
    expect(el(fixture, 'channel-EMAIL')?.getAttribute('aria-checked')).toBe('false');
    expect(el(fixture, 'preferences-default-account')?.textContent).toContain('#42');
    expect(el(fixture, 'preferences-not-set')).toBeNull();
  });

  it('says so when nothing has been saved yet', () => {
    const fixture = setUp();
    http.expectOne(URL).flush({ errorCode: 'PRF-404', message: 'x' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(el(fixture, 'preferences-not-set')).not.toBeNull();
    expect(el(fixture, 'preferences-error')).toBeNull();
  });

  it('saves the chosen channel against the signed-in account', () => {
    const fixture = setUp();
    http.expectOne(URL).flush({ errorCode: 'PRF-404', message: 'x' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    el(fixture, 'channel-PUSH')?.click();
    fixture.detectChanges();
    el(fixture, 'preferences-save')?.click();

    const request = http.expectOne(URL);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ defaultAccountId: 42, channel: 'PUSH' });
    request.flush({ accountId: 42, defaultAccountId: 42, channel: 'PUSH', updatedAt: '2026-10-06T10:15:30' });
    fixture.detectChanges();

    expect(el(fixture, 'preferences-saved')).not.toBeNull();
    expect(el(fixture, 'preferences-not-set')).toBeNull();
  });

  it('explains a refused save in plain words', () => {
    const fixture = setUp();
    http.expectOne(URL).flush({ accountId: 42, defaultAccountId: 42, channel: 'EMAIL', updatedAt: '2026-10-06T10:15:30' });
    fixture.detectChanges();

    el(fixture, 'channel-PUSH')?.click();
    el(fixture, 'preferences-save')?.click();
    http
      .expectOne(URL)
      .flush({ errorCode: 'PRF-422', message: 'Default account is not one of your accounts' }, { status: 422, statusText: 'Unprocessable' });
    fixture.detectChanges();

    expect(el(fixture, 'preferences-error')?.textContent).toContain('account');
    expect(el(fixture, 'preferences-saved')).toBeNull();
  });
});
