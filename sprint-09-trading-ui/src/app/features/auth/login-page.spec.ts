import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { provideApi } from '../../generated/auth-client';
import { LoginPage } from './login-page';

const AUTH_URL = 'http://auth.test/auth/login';

/** A signed JWT whose payload is `{"accountId":42}` - decoded by the store. */
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOjQyfQ.signature';

type LoginFixture = ComponentFixture<LoginPage>;

interface TestHarness {
  fixture: LoginFixture;
  session: SessionStore;
  router: Router;
}

describe('LoginPage', () => {
  let http: HttpTestingController;

  function setUp(queryParams: Record<string, string> = {}): TestHarness {
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: 'http://auth.test' }),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } }
      ]
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    return { fixture, session: TestBed.inject(SessionStore), router: TestBed.inject(Router) };
  }

  function root(fixture: LoginFixture): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function setInput(fixture: LoginFixture, testId: string, value: string): void {
    const input = root(fixture).querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
    if (input === null) {
      throw new Error(`expected [data-testid="${testId}"] to be rendered`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function fillCredentials(fixture: LoginFixture, username: string, password: string): void {
    setInput(fixture, 'username', username);
    setInput(fixture, 'password', password);
  }

  function submit(fixture: LoginFixture): void {
    root(fixture)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
  }

  function tokenResponse(): Record<string, unknown> {
    return {
      accessToken: TOKEN,
      refreshToken: 'refresh-token-1',
      tokenType: 'Bearer',
      expiresIn: 900
    };
  }

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    http?.verify();
  });

  it('should create', () => {
    expect(setUp().fixture.componentInstance).toBeTruthy();
  });

  it('should mask the password by default and reveal it on toggle', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();
    const compiled = root(fixture);

    const passwordInput = compiled.querySelector<HTMLInputElement>('[data-testid="password"]');
    expect(passwordInput?.type).toBe('password');

    compiled.querySelector<HTMLButtonElement>('.password-toggle-btn')?.click();
    fixture.detectChanges();

    expect(passwordInput?.type).toBe('text');
  });

  it('blocks empty fields before any sign-in request and marks the form validated', async () => {
    const { fixture, session } = setUp();
    await fixture.whenStable();
    const compiled = root(fixture);

    const form = compiled.querySelector('form');
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect(form?.classList.contains('was-validated')).toBe(true);
    http.expectNone(AUTH_URL);
    expect(session.isSignedIn()).toBe(false);
  });

  it('signs in with valid credentials, stores the session and redirects to the dashboard', async () => {
    const { fixture, session, router } = setUp();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fillCredentials(fixture, 'jane.doe', 'correct horse');

    submit(fixture);

    const request = http.expectOne(AUTH_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ username: 'jane.doe', password: 'correct horse' });
    expect(request.request.headers.has('Authorization')).toBe(false);

    request.flush(tokenResponse());
    fixture.detectChanges();

    expect(session.isSignedIn()).toBe(true);
    expect(session.accountId()).toBe(42);
    expect(session.accessToken()).toBe(TOKEN);
    expect(session.refreshToken()).toBe('refresh-token-1');
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('drops a signed-out visitor back on the address the guard stashed', async () => {
    const { fixture, session, router } = setUp({ returnUrl: '/blotter' });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fillCredentials(fixture, 'jane.doe', 'correct horse');

    submit(fixture);
    http.expectOne(AUTH_URL).flush(tokenResponse());
    fixture.detectChanges();

    expect(session.isSignedIn()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/blotter');
  });

  it('keeps the session cleared and shows a readable message when sign-in is refused', async () => {
    const { fixture, session, router } = setUp();
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fillCredentials(fixture, 'jane.doe', 'wrong password');

    submit(fixture);
    http
      .expectOne(AUTH_URL)
      .flush({ errorCode: 'AUTH-401', message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();

    expect(root(fixture).querySelector('[data-testid="login-error"]')?.textContent).toContain(
      'not recognised'
    );
    expect(session.isSignedIn()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();

    const submitButton = root(fixture).querySelector<HTMLButtonElement>('[data-testid="submit"]');
    expect(submitButton?.disabled).toBe(false);
  });

  it('explains when the sign-in service cannot be reached', async () => {
    const { fixture, session } = setUp();
    fillCredentials(fixture, 'jane.doe', 'correct horse');

    submit(fixture);
    http.expectOne(AUTH_URL).error(new ProgressEvent('network'));
    fixture.detectChanges();

    expect(root(fixture).querySelector('[data-testid="login-error"]')?.textContent).toContain(
      'connection'
    );
    expect(session.isSignedIn()).toBe(false);
  });

  it('clears a previous failure as the trader corrects a field', async () => {
    const { fixture } = setUp();
    fillCredentials(fixture, 'jane.doe', 'wrong password');

    submit(fixture);
    http
      .expectOne(AUTH_URL)
      .flush({ errorCode: 'AUTH-401', message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();
    expect(root(fixture).querySelector('[data-testid="login-error"]')).not.toBeNull();

    setInput(fixture, 'password', 'correct horse');
    expect(root(fixture).querySelector('[data-testid="login-error"]')).toBeNull();
  });

  it('links out to the registration page', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();
    const link = root(fixture).querySelector<HTMLAnchorElement>('.login-footer-text a');
    expect(link?.getAttribute('href')).toBe('/register');
  });

  it('welcomes a trader back after a successful registration', async () => {
    const { fixture } = setUp({ registered: 'true' });
    await fixture.whenStable();
    expect(
      root(fixture).querySelector('[data-testid="login-registered-banner"]')?.textContent
    ).toContain('created');
  });
});