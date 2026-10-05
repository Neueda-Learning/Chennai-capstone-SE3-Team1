import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';

import { provideApi } from '../../generated/auth-client';
import { SessionStore } from './session.store';
import { bearerInterceptor } from './bearer.interceptor';

@Component({ selector: 'tui-stub-login', template: '' })
class StubLoginPage {}

const ACCESS_TOKEN = 'signed-jwt-from-sign-in';
const REFRESHED_TOKEN = 'signed-jwt-from-refresh';
const TRADE_URL = 'http://trade.test/api/v1/accounts/1/balance';
const REFRESH_URL = 'http://auth.test/auth/refresh';
const PUBLIC = [
  'login',
  'register',
  'refresh',
  'verify-otp',
  'forgot-password',
  'resend-otp',
  'reset-password',
];

describe('bearerInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  let session: SessionStore;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([bearerInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: 'login', component: StubLoginPage }]),
        provideApi({ basePath: 'http://auth.test' })
      ]
    });
    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    httpTesting.verify();
  });

  it('attaches Authorization: Bearer for a protected call when signed in', () => {
    session.signIn(ACCESS_TOKEN, null, null);

    http.get(TRADE_URL).subscribe();

    const request = httpTesting.expectOne(TRADE_URL);
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    request.flush({ balance: 1000 });
  });

  it('keeps the token fresh from the session: a header added after sign-out disappears', () => {
    session.signIn(ACCESS_TOKEN, null, null);
    session.signOut();

    http.get(TRADE_URL).subscribe();

    const request = httpTesting.expectOne(TRADE_URL);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({ balance: 1000 });
  });

  it('sends no Authorization header when signed out', () => {
    http.get('http://trade.test/api/v1/instruments/NIFTY').subscribe();

    const request = httpTesting.expectOne('http://trade.test/api/v1/instruments/NIFTY');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('never puts the callback token on the logout call, which is bearer-protected', () => {
    session.signIn(ACCESS_TOKEN, null, null);

    http.post('http://auth.test/auth/logout', { refreshToken: 'token-1' }).subscribe();

    const request = httpTesting.expectOne('http://auth.test/auth/logout');
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    request.flush({});
  });

  for (const route of PUBLIC) {
    it(`keeps /auth/${route} anonymous even when signed in`, () => {
      session.signIn(ACCESS_TOKEN, null, null);

      http
        .post(`http://auth.test/auth/${route}`, { username: 'jane.doe', password: 'x' })
        .subscribe();

      const request = httpTesting.expectOne(`http://auth.test/auth/${route}`);
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush({});
    });
  }

  it('preserves the request body and any caller-set headers', () => {
    session.signIn(ACCESS_TOKEN, null, null);

    http
      .post('http://trade.test/api/v1/orders', { symbol: 'RELIANCE' }, {
        headers: { 'X-Trace-Id': 'abc123' }
      })
      .subscribe();

    const request = httpTesting.expectOne('http://trade.test/api/v1/orders');
    expect(request.request.headers.get('X-Trace-Id')).toBe('abc123');
    expect(request.request.body).toEqual({ symbol: 'RELIANCE' });
    request.flush({ status: 'NEW' });
  });

  describe('renewing after a 401', () => {
    it('trades the refresh token for a new access token and replays the request once', () => {
      session.signIn(ACCESS_TOKEN, 42, 'refresh-1');

      let balance: unknown;
      http.get(TRADE_URL).subscribe((body) => (balance = body));

      httpTesting
        .expectOne(TRADE_URL)
        .flush({ errorCode: 'AUTH-401', message: 'expired' }, { status: 401, statusText: 'Unauthorized' });

      const renewal = httpTesting.expectOne(REFRESH_URL);
      expect(renewal.request.method).toBe('POST');
      expect(renewal.request.body).toEqual({ refreshToken: 'refresh-1' });
      expect(renewal.request.headers.has('Authorization')).toBe(false);
      renewal.flush({
        accessToken: REFRESHED_TOKEN,
        refreshToken: 'refresh-2',
        tokenType: 'Bearer',
        expiresIn: 900
      });

      const replay = httpTesting.expectOne(TRADE_URL);
      expect(replay.request.headers.get('Authorization')).toBe(`Bearer ${REFRESHED_TOKEN}`);
      replay.flush({ balance: 250 });

      expect(balance).toEqual({ balance: 250 });
      expect(session.isSignedIn()).toBe(true);
      expect(session.accessToken()).toBe(REFRESHED_TOKEN);
      expect(session.refreshToken()).toBe('refresh-2');
    });

    it('replays with the same method, body and caller headers', () => {
      session.signIn(ACCESS_TOKEN, null, 'refresh-1');

      http
        .post('http://trade.test/api/v1/orders', { symbol: 'TCS' }, {
          headers: { 'X-Trace-Id': 'trace-9' }
        })
        .subscribe();

      httpTesting
        .expectOne('http://trade.test/api/v1/orders')
        .flush({}, { status: 401, statusText: 'Unauthorized' });
      httpTesting.expectOne(REFRESH_URL).flush({
        accessToken: REFRESHED_TOKEN,
        refreshToken: 'refresh-2',
        tokenType: 'Bearer',
        expiresIn: 900
      });

      const replay = httpTesting.expectOne('http://trade.test/api/v1/orders');
      expect(replay.request.method).toBe('POST');
      expect(replay.request.body).toEqual({ symbol: 'TCS' });
      expect(replay.request.headers.get('X-Trace-Id')).toBe('trace-9');
      replay.flush({ status: 'NEW' });
    });

    it('sends one renewal for several requests that 401 at the same moment', () => {
      session.signIn(ACCESS_TOKEN, null, 'refresh-1');

      http.get(TRADE_URL).subscribe();
      http.get('http://trade.test/api/v1/accounts/2').subscribe();

      httpTesting.expectOne(TRADE_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
      httpTesting
        .expectOne('http://trade.test/api/v1/accounts/2')
        .flush({}, { status: 401, statusText: 'Unauthorized' });

      httpTesting.expectOne(REFRESH_URL).flush({
        accessToken: REFRESHED_TOKEN,
        refreshToken: 'refresh-2',
        tokenType: 'Bearer',
        expiresIn: 900
      });

      const replays = httpTesting.match(TRADE_URL);
      expect(replays.length + httpTesting.match('http://trade.test/api/v1/accounts/2').length).toBe(2);
      for (const replay of replays) {
        expect(replay.request.headers.get('Authorization')).toBe(`Bearer ${REFRESHED_TOKEN}`);
        replay.flush({});
      }
      httpTesting.expectNone(REFRESH_URL);
    });

    it('ends the session and returns the error when the renewal itself is refused', () => {
      session.signIn(ACCESS_TOKEN, null, 'refresh-1');
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      let failure: unknown;
      http.get(TRADE_URL).subscribe({ error: (e: unknown) => (failure = e) });

      httpTesting.expectOne(TRADE_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
      httpTesting
        .expectOne(REFRESH_URL)
        .flush({ errorCode: 'AUTH-401', message: 'Invalid refresh token' }, { status: 401, statusText: 'Unauthorized' });

      expect(session.isSignedIn()).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: { returnUrl: expect.any(String) }
      });
      expect(failure).toBeInstanceOf(HttpErrorResponse);
      expect((failure as HttpErrorResponse).status).toBe(401);
    });

    it('ends the session when a replay with the fresh token is still refused', () => {
      session.signIn(ACCESS_TOKEN, null, 'refresh-1');

      http.get(TRADE_URL).subscribe({ error: () => undefined });

      httpTesting.expectOne(TRADE_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
      httpTesting.expectOne(REFRESH_URL).flush({
        accessToken: REFRESHED_TOKEN,
        refreshToken: 'refresh-2',
        tokenType: 'Bearer',
        expiresIn: 900
      });
      httpTesting.expectOne(TRADE_URL).flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(session.isSignedIn()).toBe(false);
      httpTesting.expectNone(REFRESH_URL);
    });

    it('does not renew when there is no refresh token to renew with', () => {
      session.signIn(ACCESS_TOKEN, null, null);

      http.get(TRADE_URL).subscribe({ error: () => undefined });

      httpTesting.expectOne(TRADE_URL).flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(session.isSignedIn()).toBe(false);
      httpTesting.expectNone(REFRESH_URL);
    });

    it('leaves the session alone for a failure that is not a 401', () => {
      session.signIn(ACCESS_TOKEN, null, 'refresh-1');

      let failure: unknown;
      http.get(TRADE_URL).subscribe({ error: (e: unknown) => (failure = e) });

      httpTesting
        .expectOne(TRADE_URL)
        .flush({}, { status: 500, statusText: 'Internal Server Error' });

      expect(session.isSignedIn()).toBe(true);
      expect((failure as { status: number }).status).toBe(500);
      httpTesting.expectNone(REFRESH_URL);
    });

    it('does not sign anyone out when the replay fails for an unrelated reason', () => {
      session.signIn(ACCESS_TOKEN, null, 'refresh-1');

      let failure: unknown;
      http.get(TRADE_URL).subscribe({ error: (e: unknown) => (failure = e) });

      httpTesting.expectOne(TRADE_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
      httpTesting.expectOne(REFRESH_URL).flush({
        accessToken: REFRESHED_TOKEN,
        refreshToken: 'refresh-2',
        tokenType: 'Bearer',
        expiresIn: 900
      });
      httpTesting
        .expectOne(TRADE_URL)
        .flush({}, { status: 503, statusText: 'Service Unavailable' });

      expect(session.isSignedIn()).toBe(true);
      expect((failure as { status: number }).status).toBe(503);
    });

    it('renews again on a later 401 once the first renewal has finished', () => {
      session.signIn(ACCESS_TOKEN, null, 'refresh-1');

      http.get(TRADE_URL).subscribe({ error: () => undefined });
      httpTesting.expectOne(TRADE_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
      httpTesting.expectOne(REFRESH_URL).flush({
        accessToken: REFRESHED_TOKEN,
        refreshToken: 'refresh-2',
        tokenType: 'Bearer',
        expiresIn: 900
      });
      httpTesting.expectOne(TRADE_URL).flush({}, { status: 401, statusText: 'Unauthorized' });
      session.signIn(REFRESHED_TOKEN, null, 'refresh-3');

      http.get(TRADE_URL).subscribe({ error: () => undefined });
      httpTesting.expectOne(TRADE_URL).flush({}, { status: 401, statusText: 'Unauthorized' });

      const renewal = httpTesting.expectOne(REFRESH_URL);
      expect(renewal.request.body).toEqual({ refreshToken: 'refresh-3' });
      renewal.flush({
        accessToken: 'third-token',
        refreshToken: 'refresh-4',
        tokenType: 'Bearer',
        expiresIn: 900
      });
      httpTesting.expectOne(TRADE_URL).flush({ balance: 1 });

      expect(session.accessToken()).toBe('third-token');
    });
  });
});