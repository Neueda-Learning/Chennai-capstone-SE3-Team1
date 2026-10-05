import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { provideApi } from '../../generated/auth-client';
import { RegisterPage } from './register-page';

const REGISTER_URL = 'http://auth.test/auth/register';

type RegisterFixture = ComponentFixture<RegisterPage>;

interface TestHarness {
  fixture: RegisterFixture;
  session: SessionStore;
  router: Router;
}

interface FormData {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

describe('RegisterPage', () => {
  let http: HttpTestingController;

  function setUp(): TestHarness {
    TestBed.configureTestingModule({
      imports: [RegisterPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: 'http://auth.test' })
      ]
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(RegisterPage);
    fixture.detectChanges();
    return { fixture, session: TestBed.inject(SessionStore), router: TestBed.inject(Router) };
  }

  function root(fixture: RegisterFixture): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function setInput(fixture: RegisterFixture, testId: string, value: string): void {
    const input = root(fixture).querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
    if (input === null) {
      throw new Error(`expected [data-testid="${testId}"] to be rendered`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function fillForm(fixture: RegisterFixture, data: FormData): void {
    setInput(fixture, 'username', data.username);
    setInput(fixture, 'email', data.email);
    setInput(fixture, 'password', data.password);
    setInput(fixture, 'confirm-password', data.confirmPassword);
  }

  function submit(fixture: RegisterFixture): void {
    root(fixture)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
  }

  function requirement(fixture: RegisterFixture, label: string): HTMLElement | null {
    const help = root(fixture).querySelector<HTMLElement>('[data-testid="password-help"]');
    if (help === null) {
      return null;
    }
    return (
      Array.from(help.querySelectorAll<HTMLElement>('.password-requirement')).find(
        (item) => item.textContent?.includes(label) ?? false
      ) ?? null
    );
  }

  function userResponse(): Record<string, unknown> {
    return {
      id: 'u-42',
      username: 'jane.doe',
      email: 'jane.doe@example.com',
      phone: null,
      accountId: null,
      roles: ['CUSTOMER'],
      status: 'PENDING'
    };
  }

  const validForm: FormData = {
    username: 'jane.doe',
    email: 'jane.doe@example.com',
    password: 'correct horse battery7',
    confirmPassword: 'correct horse battery7'
  };

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    http?.verify();
  });

  it('should create', () => {
    expect(setUp().fixture.componentInstance).toBeTruthy();
  });

  it('masks both password fields by default and reveals each on its own toggle', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();
    const compiled = root(fixture);

    const password = compiled.querySelector<HTMLInputElement>('[data-testid="password"]');
    const confirm = compiled.querySelector<HTMLInputElement>('[data-testid="confirm-password"]');
    expect(password?.type).toBe('password');
    expect(confirm?.type).toBe('password');

    const toggles = compiled.querySelectorAll<HTMLButtonElement>('.password-toggle-btn');
    toggles[0]?.click();
    toggles[1]?.click();
    fixture.detectChanges();

    expect(password?.type).toBe('text');
    expect(confirm?.type).toBe('text');
  });

  it('blocks empty fields before any registration request and marks the form validated', async () => {
    const { fixture, session } = setUp();
    await fixture.whenStable();
    const compiled = root(fixture);

    const form = compiled.querySelector('form');
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect(form?.classList.contains('was-validated')).toBe(true);
    http.expectNone(REGISTER_URL);
    expect(session.isSignedIn()).toBe(false);
  });

  it('shows a live password checklist that starts failing then passes', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();
    const compiled = root(fixture);

    expect(compiled.querySelector('[data-testid="password-help"]')).toBeNull();

    setInput(fixture, 'password', 'short');
    const lengthItem = requirement(fixture, 'At least 12 characters');
    expect(lengthItem?.classList.contains('text-danger')).toBe(true);

    setInput(fixture, 'password', 'correct horse battery');
    const passes = requirement(fixture, 'At least 12 characters');
    expect(passes?.classList.contains('text-success')).toBe(true);
    expect(requirement(fixture, 'Not contain "password"')?.classList.contains('text-success')).toBe(true);
  });

  it('flags the combined forbidden-content rule the service enforces', async () => {
    const { fixture } = setUp();
    const compiled = root(fixture);

    setInput(fixture, 'password', 'Password123456');
    expect(requirement(fixture, 'Not contain "password"')?.classList.contains('text-danger')).toBe(true);
    setInput(fixture, 'password', 'dfghjkdfghjk');
    expect(requirement(fixture, 'keyboard patterns')?.classList.contains('text-danger')).toBe(true);
    setInput(fixture, 'password', '345678345678');
    expect(requirement(fixture, 'sequential')?.classList.contains('text-danger')).toBe(true);
    setInput(fixture, 'password', 'a!b@c!d#e7x');
    expect(requirement(fixture, 'Not contain "password"')?.classList.contains('text-success')).toBe(true);
    expect(compiled.querySelector('[data-testid="register-error"]')).toBeNull();
  });

  it('refuses to submit a password that violates the policy', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();
    setInput(fixture, 'username', 'jane.doe');
    setInput(fixture, 'email', 'jane.doe@example.com');
    setInput(fixture, 'password', 'password123456');
    setInput(fixture, 'confirm-password', 'password123456');
    fixture.detectChanges();

    submit(fixture);

    expect(root(fixture).querySelector('[data-testid="register-error"]')).toBeNull();
    expect(requirement(fixture, 'Not contain "password"')?.classList.contains('text-danger')).toBe(true);
    http.expectNone(REGISTER_URL);
  });

  it('demands at least one number or special character as the trader types', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();

    setInput(fixture, 'password', 'twelvecharlower');
    expect(
      requirement(fixture, 'number or special character')?.classList.contains('text-danger')
    ).toBe(true);

    setInput(fixture, 'password', 'twelvechar7low');
    expect(
      requirement(fixture, 'number or special character')?.classList.contains('text-success')
    ).toBe(true);
  });

  it('warns live when the confirmation does not match, without submitting', async () => {
    const { fixture } = setUp();
    fillForm(fixture, { ...validForm, confirmPassword: 'something else entirely' });

    const confirmHelp = root(fixture).querySelector<HTMLElement>('[data-testid="confirm-password-help"]');
    expect(confirmHelp?.classList.contains('text-danger')).toBe(true);
    expect(confirmHelp?.textContent).toContain('do not match');
    expect(root(fixture).querySelector('[data-testid="register-error"]')).toBeNull();
    http.expectNone(REGISTER_URL);

    setInput(fixture, 'confirm-password', validForm.password);
    expect(root(fixture).querySelector('[data-testid="confirm-password-help"]')?.classList.contains('text-success')).toBe(true);
  });

  it('refuses mismatched passwords without calling the service', async () => {
    const { fixture } = setUp();
    fillForm(fixture, { ...validForm, confirmPassword: 'something else entirely' });

    submit(fixture);

    expect(root(fixture).querySelector('[data-testid="register-error"]')?.textContent).toContain(
      'do not match'
    );
    http.expectNone(REGISTER_URL);
  });

  it('registers a valid user, sends no Authorization header, and hands back to email verification', async () => {
    const { fixture, session, router } = setUp();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fillForm(fixture, validForm);

    submit(fixture);

    const request = http.expectOne(REGISTER_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      username: 'jane.doe',
      email: 'jane.doe@example.com',
      password: 'correct horse battery7'
    });
    expect(request.request.headers.has('Authorization')).toBe(false);

    request.flush(userResponse());
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/verify-otp'], {
      queryParams: { email: 'jane.doe@example.com' }
    });
    expect(session.isSignedIn()).toBe(false);
  });

  it('stays put with a readable message when the username is already registered', async () => {
    const { fixture, session, router } = setUp();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fillForm(fixture, validForm);

    submit(fixture);
    http
      .expectOne(REGISTER_URL)
      .flush({ errorCode: 'AUTH-409', message: 'Registration failed' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(root(fixture).querySelector('[data-testid="register-error"]')?.textContent).toContain(
      'already registered'
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(session.isSignedIn()).toBe(false);

    const submitButton = root(fixture).querySelector<HTMLButtonElement>('[data-testid="submit"]');
    expect(submitButton?.disabled).toBe(false);
  });

  it('explains when the registration service cannot be reached', async () => {
    const { fixture, session } = setUp();
    fillForm(fixture, validForm);

    submit(fixture);
    http.expectOne(REGISTER_URL).error(new ProgressEvent('network'));
    fixture.detectChanges();

    expect(root(fixture).querySelector('[data-testid="register-error"]')?.textContent).toContain(
      'connection'
    );
    expect(session.isSignedIn()).toBe(false);
  });

  it('clears a previous failure as the trader corrects a field', async () => {
    const { fixture } = setUp();
    fillForm(fixture, validForm);

    submit(fixture);
    http
      .expectOne(REGISTER_URL)
      .flush({ errorCode: 'AUTH-409', message: 'Registration failed' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(root(fixture).querySelector('[data-testid="register-error"]')).not.toBeNull();

    setInput(fixture, 'email', 'other@example.com');
    expect(root(fixture).querySelector('[data-testid="register-error"]')).toBeNull();
  });
});