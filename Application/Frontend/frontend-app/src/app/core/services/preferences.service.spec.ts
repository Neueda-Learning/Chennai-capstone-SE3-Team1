import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SessionStore } from '../auth/session.store';
import { provideApi } from '../../generated/trade-client';
import { PreferencesService } from './preferences.service';

const URL = 'http://trade.test/api/v1/accounts/42/preferences';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';

const STORED = { accountId: 42, defaultAccountId: 42, channel: 'PUSH', updatedAt: '2026-10-06T10:15:30' };

describe('PreferencesService', () => {
  let service: PreferencesService;
  let http: HttpTestingController;
  let session: SessionStore;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi({ basePath: 'http://trade.test' })]
    });
    service = TestBed.inject(PreferencesService);
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
    session.signIn(TOKEN, null, null);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('reads the stored preference from the account-scoped route', () => {
    let result: unknown;
    service.get(42).subscribe((value) => (result = value));

    const request = http.expectOne(URL);
    expect(request.request.method).toBe('GET');
    request.flush(STORED);

    expect(result).toEqual(STORED);
  });

  it('writes the default account and channel, and nothing else', () => {
    service.put(42, { defaultAccountId: 42, channel: 'PUSH' }).subscribe();

    const request = http.expectOne(URL);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ defaultAccountId: 42, channel: 'PUSH' });
    request.flush({ ...STORED, channel: 'PUSH' });
  });

  it('applyDefaultAccount reports true when the stored default is the signed-in account', () => {
    let applied: boolean | undefined;
    service.applyDefaultAccount(42).subscribe((value) => (applied = value));

    http.expectOne(URL).flush(STORED);

    expect(applied).toBe(true);
  });

  it('applyDefaultAccount reports false and keeps the session when the stored default is another account', () => {
    let applied: boolean | undefined;
    service.applyDefaultAccount(42).subscribe((value) => (applied = value));

    http.expectOne(URL).flush({ ...STORED, defaultAccountId: 7 });

    expect(applied).toBe(false);
    expect(session.accountId()).toBe(42);
  });

  it('applyDefaultAccount swallows a 404 and a server failure', () => {
    const results: boolean[] = [];
    service.applyDefaultAccount(42).subscribe((value) => results.push(value));
    http.expectOne(URL).flush({ errorCode: 'PRF-404', message: 'x' }, { status: 404, statusText: 'Not Found' });

    service.applyDefaultAccount(42).subscribe((value) => results.push(value));
    http.expectOne(URL).flush({ errorCode: 'INTERNAL-500', message: 'x' }, { status: 500, statusText: 'Server Error' });

    expect(results).toEqual([false, false]);
  });

  it('applyDefaultAccount gives up after the timeout instead of holding the sign-in', () => {
    vi.useFakeTimers();
    try {
      let applied: boolean | undefined;
      service.applyDefaultAccount(42).subscribe((value) => (applied = value));
      const request = http.expectOne(URL);

      vi.advanceTimersByTime(3001);

      expect(applied).toBe(false);
      expect(request.cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
