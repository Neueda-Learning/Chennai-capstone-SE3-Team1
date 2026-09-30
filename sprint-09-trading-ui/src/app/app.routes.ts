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
