import { Routes } from '@angular/router';

import { authGuard, authGuardChild } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/landing/landing-page').then((m) => m.LandingPage)
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage)
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register-page').then((m) => m.RegisterPage)
  },
  {
    path: 'app',
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
        path: 'portfolio',
        loadComponent: () =>
          import('./features/portfolio/portfolio-page').then((m) => m.PortfolioPage)
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
        path: 'watchlists',
        loadComponent: () =>
          import('./features/watchlists/watchlists-page').then((m) => m.WatchlistsPage)
      },
      {
        path: 'account',
        loadComponent: () => import('./features/account/account-page').then((m) => m.AccountPage)
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage)
      },
      {
        path: 'bank-accounts',
        loadComponent: () =>
          import('./features/bank-accounts/bank-account-page').then((m) => m.BankAccountPage)
      }
    ]
  },
  {
    path: 'dashboard',
    redirectTo: 'app/dashboard'
  },
  {
    path: 'portfolio',
    redirectTo: 'app/portfolio'
  },
  {
    path: 'orders',
    redirectTo: 'app/orders'
  },
  {
    path: 'blotter',
    redirectTo: 'app/blotter'
  },
  {
    path: 'watchlists',
    redirectTo: 'app/watchlists'
  },
  {
    path: 'account',
    redirectTo: 'app/account'
  },
  {
    path: 'settings',
    redirectTo: 'app/settings'
  },
  {
    path: 'bank-accounts',
    redirectTo: 'app/bank-accounts'
  },
  {
    path: '**',
    redirectTo: ''
  }
];
