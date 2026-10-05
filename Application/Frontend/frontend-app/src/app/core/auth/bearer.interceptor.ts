import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  finalize,
  map,
  of,
  shareReplay,
  switchMap,
  throwError
} from 'rxjs';

import { AuthService, TokenResponse } from '../../generated/auth-client';
import { SessionStore } from './session.store';

const PUBLIC_AUTH_ENDPOINTS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/verify-otp',
  '/auth/forgot-password',
  '/auth/resend-otp',
  '/auth/reset-password',
];

function isPublicAuthEndpoint(url: string): boolean {
  const path = url.split('?')[0];
  return PUBLIC_AUTH_ENDPOINTS.some(
    (endpoint) => path === endpoint || path.endsWith(endpoint)
  );
}

let renewalInFlight: Observable<TokenResponse> | null = null;

function renewOnce(auth: AuthService, session: SessionStore): Observable<TokenResponse> {
  if (renewalInFlight === null) {
    const refreshToken = session.refreshToken();
    if (refreshToken === null) {
      return throwError(() => new Error('No refresh token to renew the session with'));
    }
    renewalInFlight = auth.refresh({ refreshRequest: { refreshToken } }).pipe(
      map((tokens) => {
        session.adoptTokens(
          tokens.accessToken,
          session.accountId(),
          tokens.refreshToken ?? refreshToken
        );
        return tokens;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
      finalize(() => {
        renewalInFlight = null;
      })
    );
  }
  return renewalInFlight;
}

function endSession(
  session: SessionStore,
  router: Router,
  failure: HttpErrorResponse
): Observable<never> {
  console.warn('[Auth] Session could not be renewed - signing out');
  session.signOut();
  void router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
  return throwError(() => failure);
}

export const bearerInterceptor: HttpInterceptorFn = (request, next) => {
  if (isPublicAuthEndpoint(request.url)) {
    return next(request);
  }

  const session = inject(SessionStore);
  const router = inject(Router);
  const auth = inject(AuthService);
  const accessToken = session.accessToken();

  if (accessToken === null) {
    return next(request);
  }

  return next(
    request.clone({
      setHeaders: { Authorization: `Bearer ${accessToken}` }
    })
  ).pipe(
    catchError((failure: unknown) => {
      if (!(failure instanceof HttpErrorResponse) || failure.status !== 401) {
        return throwError(() => failure);
      }

      if (session.refreshToken() === null) {
        return endSession(session, router, failure);
      }

      return renewOnce(auth, session).pipe(
        switchMap(() =>
          next(
            request.clone({
              setHeaders: { Authorization: `Bearer ${session.accessToken() ?? ''}` }
            })
          )
        ),
        catchError((retryFailure: unknown) => {
          if (retryFailure instanceof HttpErrorResponse && retryFailure.status === 401) {
            return endSession(session, router, retryFailure);
          }
          return throwError(() => retryFailure);
        })
      );
    })
  );
};