import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { provideApi } from '../../generated/auth-client';
import { VerifyOtpPage } from './verify-otp-page';

const VERIFY_URL = 'http://auth.test/auth/verify-otp';
const RESEND_URL = 'http://auth.test/auth/resend-otp';

type VerifyFixture = ComponentFixture<VerifyOtpPage>;

interface TestHarness {
  fixture: VerifyFixture;
  session: SessionStore;
  router: Router;
}

describe('VerifyOtpPage', () => {
  let http: HttpTestingController;

  function setUp(queryParams: Record<string, string> = { email: 'jane.doe@example.com' }): TestHarness {
    TestBed.configureTestingModule({
      imports: [VerifyOtpPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: 'http://auth.test' }),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new URLSearchParams(queryParams) } } }
      ]
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(VerifyOtpPage);
    fixture.detectChanges();
    return { fixture, session: TestBed.inject(SessionStore), router: TestBed.inject(Router) };
  }

  function root(fixture: VerifyFixture): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function setInput(fixture: VerifyFixture, testId: string, value: string): void {
    const input = root(fixture).querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
    if (input === null) {
      throw new Error(`expected [data-testid="${testId}"] to be rendered`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(fixture: VerifyFixture): void {
    root(fixture)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
  }

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    http?.verify();
  });

  it('should create', () => {
    expect(setUp().fixture.componentInstance).toBeTruthy();
  });

  it('carries the email over from registration, read-only', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();

    const email = root(fixture).querySelector<HTMLInputElement>('[data-testid="verify-email"]');
    expect(email?.value).toBe('jane.doe@example.com');
    expect(email?.readOnly).toBe(true);
  });

  it('does not call the service until six digits are typed', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();

    setInput(fixture, 'otp', '123');
    submit(fixture);
    http.expectNone(VERIFY_URL);

    setInput(fixture, 'otp', '12345a');
    submit(fixture);
    http.expectNone(VERIFY_URL);

    setInput(fixture, 'otp', '123456');
    submit(fixture);

    const request = http.expectOne(VERIFY_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'jane.doe@example.com', otp: '123456' });
    expect(request.request.headers.has('Authorization')).toBe(false);
  });

  it('verifies the code and hands the trader to sign-in, without signing them in', async () => {
    const { fixture, session, router } = setUp();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    setInput(fixture, 'otp', '123456');

    submit(fixture);
    http.expectOne(VERIFY_URL).flush({ verified: true });
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { verified: 'true' } });
    expect(session.isSignedIn()).toBe(false);
  });

  it('explains a rejected code and stays put, re-enabling the button', async () => {
    const { fixture, router } = setUp();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    setInput(fixture, 'otp', '000000');

    submit(fixture);
    http
      .expectOne(VERIFY_URL)
      .flush(
        { errorCode: 'AUTH-410', message: 'The verification code is invalid or has expired' },
        { status: 410, statusText: 'Gone' }
      );
    fixture.detectChanges();

    expect(root(fixture).querySelector('[data-testid="verify-error"]')?.textContent).toContain(
      'expired'
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(root(fixture).querySelector<HTMLButtonElement>('[data-testid="submit"]')?.disabled).toBe(false);
  });

  it('asks for a replacement code and says so without claiming the account exists', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();

    root(fixture).querySelector<HTMLElement>('[data-testid="resend"]')?.click();
    fixture.detectChanges();

    const request = http.expectOne(RESEND_URL);
    expect(request.request.body).toEqual({ email: 'jane.doe@example.com' });
    request.flush({ sent: true });
    fixture.detectChanges();

    const notice = root(fixture).querySelector('[data-testid="verify-notice"]');
    expect(notice?.textContent).toContain('new code');
    expect(notice?.textContent).not.toContain('jane.doe@example.com');
  });

  it('reports a failed resend instead of implying a code is on its way', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();

    root(fixture).querySelector<HTMLElement>('[data-testid="resend"]')?.click();
    http.expectOne(RESEND_URL).flush('nope', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(root(fixture).querySelector('[data-testid="verify-notice"]')).toBeNull();
    expect(root(fixture).querySelector('[data-testid="verify-error"]')).not.toBeNull();
  });

  it('blocks the resend when no email is on the route', async () => {
    const { fixture } = setUp({});
    await fixture.whenStable();

    root(fixture).querySelector<HTMLElement>('[data-testid="resend"]')?.click();
    fixture.detectChanges();

    http.expectNone(RESEND_URL);
  });
});
