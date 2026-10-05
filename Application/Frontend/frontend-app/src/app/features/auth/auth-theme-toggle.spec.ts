import { Type } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { THEME_STORAGE } from '../../core/theme/theme.service';
import { provideApi } from '../../generated/auth-client';
import { ForgotPasswordPage } from './forgot-password-page';
import { LoginPage } from './login-page';
import { RegisterPage } from './register-page';
import { ResetPasswordPage } from './reset-password-page';
import { VerifyOtpPage } from './verify-otp-page';

describe('theme toggle on the pages without a navbar', () => {
  const pages: [string, Type<unknown>][] = [
    ['login', LoginPage],
    ['register', RegisterPage],
    ['verify-otp', VerifyOtpPage],
    ['forgot-password', ForgotPasswordPage],
    ['reset-password', ResetPasswordPage]
  ];

  beforeEach(() => {
    sessionStorage.clear();
    document.documentElement.setAttribute('data-bs-theme', 'light');
  });

  it.each(pages)('%s page has a working theme switch', (_name, page) => {
    TestBed.configureTestingModule({
      imports: [page],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: 'http://auth.test' }),
        { provide: THEME_STORAGE, useValue: window.sessionStorage },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } }
      ]
    });
    const fixture = TestBed.createComponent(page);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.login-brand, .login-logo, .login-wrapper span')?.textContent ?? root.textContent).toContain('YRVTrading');

    const toggle = root.querySelector<HTMLButtonElement>('.theme-toggle-floating [data-testid="theme-toggle"]');
    expect(toggle).not.toBeNull();

    toggle!.click();
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');

    toggle!.click();
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
  });
});
