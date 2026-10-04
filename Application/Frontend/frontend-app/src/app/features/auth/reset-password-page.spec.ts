import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { provideApi } from '../../generated/auth-client';
import { ResetPasswordPage } from './reset-password-page';

const RESET_URL = 'http://auth.test/auth/reset-password';

type ResetFixture = ComponentFixture<ResetPasswordPage>;

interface TestHarness {
  fixture: ResetFixture;
  session: SessionStore;
  router: Router;
}

describe('ResetPasswordPage', () => {
  let http: HttpTestingController;

  function setUp(email = 'jane.doe@example.com'): TestHarness {
    TestBed.configureTestingModule({
      imports: [ResetPasswordPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: 'http://auth.test' }),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new URLSearchParams({ email }) } } }
      ]
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ResetPasswordPage);
    fixture.detectChanges();
    return { fixture, session: TestBed.inject(SessionStore), router: TestBed.inject(Router) };
  }

  function root(fixture: ResetFixture): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function setInput(fixture: ResetFixture, testId: string, value: string): void {
    const input = root(fixture).querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
    if (input === null) {
      throw new Error(`expected [data-testid="${testId}"] to be rendered`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(fixture: ResetFixture): void {
    root(fixture)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
  }

  function requirement(fixture: ResetFixture, label: string): HTMLElement | null {
    const help = root(fixture).querySelector<HTMLElement>('[data-testid="reset-password-help"]');
    if (help === null) {
      return null;
    }
    return (
      Array.from(help.querySelectorAll<HTMLElement>('.password-requirement')).find(
        (item) => item.textContent?.includes(label) ?? false
      ) ?? null
    );
  }

  const NEW_PASSWORD = 'lantern-tulip-42';

  function fillForm(fixture: ResetFixture, otp = '123456', password = NEW_PASSWORD, confirm = password): void {
    setInput(fixture, 'reset-otp', otp);
    setInput(fixture, 'reset-password', password);
    setInput(fixture, 'reset-confirm-password', confirm);
  }

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    http?.verify();
  });

  it('should create', () => {
    expect(setUp().fixture.componentInstance).toBeTruthy();
  });

  it('carries the email over from the forgot-password screen', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();

    const email = root(fixture).querySelector<HTMLInputElement>('[data-testid="reset-email"]');
    expect(email?.value).toBe('jane.doe@example.com');
    expect(email?.readOnly).toBe(true);
  });

  it('masks both password fields by default and reveals each on its own toggle', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();

    const password = root(fixture).querySelector<HTMLInputElement>('[data-testid="reset-password"]');
    const confirm = root(fixture).querySelector<HTMLInputElement>('[data-testid="reset-confirm-password"]');
    expect(password?.type).toBe('password');
    expect(confirm?.type).toBe('password');

    const toggles = root(fixture).querySelectorAll<HTMLButtonElement>('.password-toggle-btn');
    toggles[0]?.click();
    toggles[1]?.click();
    fixture.detectChanges();

    expect(password?.type).toBe('text');
    expect(confirm?.type).toBe('text');
  });

  it('shows the same live policy checklist the register screen does', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();

    expect(root(fixture).querySelector('[data-testid="reset-password-help"]')).toBeNull();

    setInput(fixture, 'reset-password', 'short');
    expect(requirement(fixture, 'At least 12 characters')?.classList.contains('text-danger')).toBe(true);

    setInput(fixture, 'reset-password', NEW_PASSWORD);
    expect(requirement(fixture, 'At least 12 characters')?.classList.contains('text-success')).toBe(true);
    expect(
      requirement(fixture, 'number or special character')?.classList.contains('text-success')
    ).toBe(true);

    setInput(fixture, 'reset-password', 'password12345678');
    expect(requirement(fixture, 'Not contain "password"')?.classList.contains('text-danger')).toBe(true);
  });

  it('refuses to submit a password that fails the policy', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();
    fillForm(fixture, '123456', 'password12345678', 'password12345678');

    submit(fixture);

    http.expectNone(RESET_URL);
    expect(requirement(fixture, 'Not contain "password"')?.classList.contains('text-danger')).toBe(true);
  });

  it('refuses mismatched passwords without calling the service', async () => {
    const { fixture } = setUp();
    fillForm(fixture, '123456', NEW_PASSWORD, 'something else entirely');

    submit(fixture);

    expect(root(fixture).querySelector('[data-testid="reset-error"]')?.textContent).toContain(
      'do not match'
    );
    http.expectNone(RESET_URL);
  });

  it('refuses to submit until the code is six digits', async () => {
    const { fixture } = setUp();
    fillForm(fixture, '12345');

    submit(fixture);

    http.expectNone(RESET_URL);
  });

  it('changes the password and hands the trader to sign-in, without signing them in', async () => {
    const { fixture, session, router } = setUp();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fillForm(fixture);

    submit(fixture);

    const request = http.expectOne(RESET_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: 'jane.doe@example.com',
      otp: '123456',
      newPassword: NEW_PASSWORD
    });
    expect(request.request.headers.has('Authorization')).toBe(false);

    request.flush({ reset: true });

    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { reset: 'true' } });
    expect(session.isSignedIn()).toBe(false);
  });

  it('explains a rejected code and stays put', async () => {
    const { fixture, router } = setUp();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fillForm(fixture, '000000');

    submit(fixture);
    http
      .expectOne(RESET_URL)
      .flush(
        { errorCode: 'AUTH-410', message: 'The verification code is invalid or has expired' },
        { status: 410, statusText: 'Gone' }
      );
    fixture.detectChanges();

    expect(root(fixture).querySelector('[data-testid="reset-error"]')?.textContent).toContain(
      'expired'
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(root(fixture).querySelector<HTMLButtonElement>('[data-testid="submit"]')?.disabled).toBe(false);
  });

  it('explains a new password the service still refused', async () => {
    const { fixture } = setUp();
    fillForm(fixture);

    submit(fixture);
    http
      .expectOne(RESET_URL)
      .flush(
        { errorCode: 'VAL-422', message: 'Password does not meet security requirements' },
        { status: 422, statusText: 'Unprocessable Entity' }
      );
    fixture.detectChanges();

    expect(root(fixture).querySelector('[data-testid="reset-error"]')?.textContent).toContain(
      'not valid'
    );
  });
});
