import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { provideApi } from '../../generated/auth-client';
import { SessionStore } from '../auth/session.store';
import { Shell } from './shell';

describe('Shell', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: 'http://auth.test' })
      ]
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http?.verify();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(Shell);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the three navigation links', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const links = Array.from(compiled.querySelectorAll('.sidebar-menu-link')).map((el) =>
      el.textContent?.trim()
    );
    expect(links).toEqual(['Dashboard', 'Order Ticket', 'Blotter']);
  });

  it('should open the mobile sidebar on toggle', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const toggleBtn = compiled.querySelector<HTMLButtonElement>('.sidebar-toggle-btn');
    toggleBtn?.click();
    fixture.detectChanges();

    expect(compiled.querySelector('.sidebar-wrapper')?.classList.contains('show')).toBe(true);
  });

  it('signs out, clears the session and navigates to the login page', async () => {
    const fixture = TestBed.createComponent(Shell);
    const session = TestBed.inject(SessionStore);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    session.signIn('token', null, 'refresh-token-1', false);
    expect(session.isSignedIn()).toBe(true);

    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const logout = compiled.querySelector<HTMLButtonElement>('[data-testid="logout"]');
    expect(logout).not.toBeNull();

    logout?.click();
    fixture.detectChanges();

    const request = http.expectOne('http://auth.test/auth/logout');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ refreshToken: 'refresh-token-1' });

    request.error(new ProgressEvent('network'), { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();

    expect(session.isSignedIn()).toBe(false);
    expect(session.accessToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });
});