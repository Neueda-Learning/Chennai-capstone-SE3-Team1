import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { provideApi } from '../../generated/auth-client';
import { ForgotPasswordPage } from './forgot-password-page';

const FORGOT_URL = 'http://auth.test/auth/forgot-password';

type ForgotFixture = ComponentFixture<ForgotPasswordPage>;

interface TestHarness {
  fixture: ForgotFixture;
  session: SessionStore;
  router: Router;
}

describe('ForgotPasswordPage', () => {
  let http: HttpTestingController;

  function setUp(): TestHarness {
    TestBed.configureTestingModule({
      imports: [ForgotPasswordPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: 'http://auth.test' })
      ]
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ForgotPasswordPage);
    fixture.detectChanges();
    return { fixture, session: TestBed.inject(SessionStore), router: TestBed.inject(Router) };
  }

  function root(fixture: ForgotFixture): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function setInput(fixture: ForgotFixture, value: string): void {
    const input = root(fixture).querySelector<HTMLInputElement>('[data-testid="forgot-email"]');
    if (input === null) {
      throw new Error('expected [data-testid="forgot-email"] to be rendered');
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(fixture: ForgotFixture): void {
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

  it('blocks an empty submit before any request', async () => {
    const { fixture } = setUp();
    await fixture.whenStable();

    const form = root(fixture).querySelector('form');
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect(form?.classList.contains('was-validated')).toBe(true);
    http.expectNone(FORGOT_URL);
  });

  it('sends the trimmed address and moves on to the reset screen', async () => {
    const { fixture, session, router } = setUp();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    setInput(fixture, '  jane.doe@example.com  ');

    submit(fixture);

    const request = http.expectOne(FORGOT_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'jane.doe@example.com' });
    expect(request.request.headers.has('Authorization')).toBe(false);

    request.flush({ sent: true });
    expect(navigate).toHaveBeenCalledWith(['/reset-password'], {
      queryParams: { email: 'jane.doe@example.com' }
    });
    expect(session.isSignedIn()).toBe(false);
  });

  it('moves on even when the address is not on file, so the route cannot be used to probe for accounts', async () => {
    const { fixture, router } = setUp();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    setInput(fixture, 'ghost@example.com');

    submit(fixture);
    // The service answers 200 with the same body whatever the address was.
    http.expectOne(FORGOT_URL).flush({ sent: true });

    expect(navigate).toHaveBeenCalledWith(['/reset-password'], {
      queryParams: { email: 'ghost@example.com' }
    });
  });

  it('stays put with a readable message when the service is unreachable', async () => {
    const { fixture, router } = setUp();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    setInput(fixture, 'jane.doe@example.com');

    submit(fixture);
    http.expectOne(FORGOT_URL).error(new ProgressEvent('network'));
    fixture.detectChanges();

    expect(root(fixture).querySelector('[data-testid="forgot-error"]')?.textContent).toContain(
      'connection'
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('clears a previous failure as the address is corrected', async () => {
    const { fixture } = setUp();
    setInput(fixture, 'jane.doe@example.com');

    submit(fixture);
    http.expectOne(FORGOT_URL).error(new ProgressEvent('network'));
    fixture.detectChanges();
    expect(root(fixture).querySelector('[data-testid="forgot-error"]')).not.toBeNull();

    setInput(fixture, 'other@example.com');
    expect(root(fixture).querySelector('[data-testid="forgot-error"]')).toBeNull();
  });
});
