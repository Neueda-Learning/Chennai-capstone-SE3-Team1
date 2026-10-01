import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { SessionStore } from './session.store';
import { bearerInterceptor } from './bearer.interceptor';

const ACCESS_TOKEN = 'signed-jwt-from-sign-in';
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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([bearerInterceptor])),
        provideHttpClientTesting()
      ]
    });
    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    httpTesting.verify();
  });

  it('attaches Authorization: Bearer for a protected call when signed in', () => {
    session.signIn(ACCESS_TOKEN, null, null, false);

    http.get('http://trade.test/api/v1/accounts/1/balance').subscribe();

    const request = httpTesting.expectOne('http://trade.test/api/v1/accounts/1/balance');
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    request.flush({ balance: 1000 });
  });

  it('keeps the token fresh from the session: a header added after sign-out disappears', () => {
    session.signIn(ACCESS_TOKEN, null, null, false);
    session.signOut();

    http.get('http://trade.test/api/v1/accounts/1/balance').subscribe();

    const request = httpTesting.expectOne('http://trade.test/api/v1/accounts/1/balance');
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
    session.signIn(ACCESS_TOKEN, null, null, false);

    http.post('http://auth.test/auth/logout', { refreshToken: 'token-1' }).subscribe();

    const request = httpTesting.expectOne('http://auth.test/auth/logout');
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    request.flush({});
  });

  for (const route of PUBLIC) {
    it(`keeps /auth/${route} anonymous even when signed in`, () => {
      session.signIn(ACCESS_TOKEN, null, null, false);

      http
        .post(`http://auth.test/auth/${route}`, { username: 'jane.doe', password: 'x' })
        .subscribe();

      const request = httpTesting.expectOne(`http://auth.test/auth/${route}`);
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush({});
    });
  }

  it('preserves the request body and any caller-set headers', () => {
    session.signIn(ACCESS_TOKEN, null, null, false);

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
});