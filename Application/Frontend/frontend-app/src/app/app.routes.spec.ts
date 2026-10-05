import { routes } from './app.routes';
import { authGuard, authGuardChild } from './core/auth/auth.guard';

describe('app routes', () => {
  it('keeps the guarded shell and redirects intact', () => {
    const appRoute = routes.find((route) => route.path === 'app');

    expect(appRoute).toBeDefined();
    expect(appRoute?.canActivate).toEqual([authGuard]);
    expect(appRoute?.canActivateChild).toEqual([authGuardChild]);
    expect(appRoute?.children?.map((route) => route.path)).toEqual([
      '',
      'dashboard',
      'portfolio',
      'orders',
      'blotter',
      'account',
      'settings',
      'bank-accounts'
    ]);

    expect(routes.find((route) => route.path === 'dashboard')?.redirectTo).toBe('app/dashboard');
    expect(routes.find((route) => route.path === 'settings')?.redirectTo).toBe('app/settings');
    expect(routes.find((route) => route.path === '**')?.redirectTo).toBe('');
  });

  it('lazy-loads the public pages', async () => {
    const pagePaths = ['', 'login', 'register', 'verify-otp', 'forgot-password', 'reset-password'];
    const loadedNames = await Promise.all(
      pagePaths.map(async (path) => {
        const route = routes.find((candidate) => candidate.path === path);
        const component = (await route?.loadComponent?.()) as { name?: string } | undefined;

        return component?.name?.replace(/^_/, '');
      })
    );

    expect(loadedNames).toEqual([
      'LandingPage',
      'LoginPage',
      'RegisterPage',
      'VerifyOtpPage',
      'ForgotPasswordPage',
      'ResetPasswordPage'
    ]);
  });
});