import { Routes } from '@angular/router';

import { authGuard, authGuardChild } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    // Deliberately unguarded: this is the one route a signed-out visitor is
    // allowed to reach, because it is the one that lets them fix that.
    path: 'login',
    loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage)
  },
  {
    // Unguarded like sign-in: creating an account is something a signed-out
    // visitor must be able to do without a session.
    path: 'register',
    loadComponent: () => import('./features/auth/register-page').then((m) => m.RegisterPage)
  },
  {
    // Unguarded for the same reason as register: a new account cannot sign in
    // until the emailed code is spent, so this is part of signing up.
    path: 'verify-otp',
    loadComponent: () =>
      import('./features/auth/verify-otp-page').then((m) => m.VerifyOtpPage)
  },
  {
    // Unguarded: a visitor locked out of their password has no session to guard.
    path: 'forgot-password',
    loadComponent: () =>
      import('./features/auth/forgot-password-page').then((m) => m.ForgotPasswordPage)
  },
  {
    // Unguarded, and paired with forgot-password: the code in the email is the
    // only thing standing in for the session this route has no access to.
    path: 'reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password-page').then((m) => m.ResetPasswordPage)
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuardChild],
    loadComponent: () => import('./core/layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage)
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./features/orders/order-ticket-page').then((m) => m.OrderTicketPage)
      },
      {
        path: 'blotter',
        loadComponent: () => import('./features/blotter/blotter-page').then((m) => m.BlotterPage)
      },
      {
        path: 'bank-accounts',
        loadComponent: () =>
          import('./features/bank-accounts/bank-account-page').then((m) => m.BankAccountPage)
      }
    ]
  },
  {
    // An unknown URL would otherwise leave the outlet empty — a blank page with
    // no explanation, which is the outcome the ticket warns about. Hand it to
    // the guarded root, so it either lands on the dashboard or gets bounced to
    // sign-in with somewhere to come back to.
    path: '**',
    redirectTo: ''
  }
];
