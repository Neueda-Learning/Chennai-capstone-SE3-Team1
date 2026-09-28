import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage)
  },
  {
    path: '',
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
      }
    ]
  }
];
