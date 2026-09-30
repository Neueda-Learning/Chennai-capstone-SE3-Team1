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

  function userResponse(): Record<string, unknown> {
    return {
      id: 'u-42',
      username: 'jane.doe',
      email: 'jane.doe@example.com',
      phone: null,
      accountId: null,
      roles: ['CUSTOMER']
    };
  }

  const validForm: FormData = {
    username: 'jane.doe',
    email: 'jane.doe@example.com',
    password: 'correct horse battery',
    confirmPassword: 'correct horse battery'
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

  it('shows a live length hint on the password once the trader types', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();
    const compiled = root(fixture);

    expect(compiled.querySelector('[data-testid="password-help"]')).toBeNull();

    setInput(fixture, 'password', 'short');
    const shortHelp = compiled.querySelector<HTMLElement>('[data-testid="password-help"]');
    expect(shortHelp?.classList.contains('text-danger')).toBe(true);
    expect(shortHelp?.textContent).toContain('at least 12 characters');

    setInput(fixture, 'password', 'correct horse battery');
    const okHelp = compiled.querySelector<HTMLElement>('[data-testid="password-help"]');
    expect(okHelp?.classList.contains('text-success')).toBe(true);
    expect(okHelp?.textContent).toContain('length requirement');
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

  it('registers a valid user, sends no Authorization header, and hands back to sign-in', async () => {
    const { fixture, session, router } = setUp();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fillForm(fixture, validForm);

    submit(fixture);

    const request = http.expectOne(REGISTER_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      username: 'jane.doe',
      email: 'jane.doe@example.com',
      password: 'correct horse battery'
    });
    expect(request.request.headers.has('Authorization')).toBe(false);

    request.flush(userResponse());
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { registered: 'true' } });
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