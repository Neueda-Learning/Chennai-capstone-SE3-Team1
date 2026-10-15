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

let renewalInFlight: Observable<void> | null = null;

/**
 * Renews the session once, however many requests (or pages) ask at the same moment, and stores the
 * new tokens. Every caller must use this instead of calling auth.refresh itself: a refresh token is
 * single-use, and presenting a replaced one makes the auth service treat it as theft.
 *
 * If the server refuses our refresh token because another tab of this browser renewed with it a
 * moment earlier, that tab's new tokens are already in localStorage: they are adopted instead of
 * signing the user out.
 */
export function renewSession(auth: AuthService, session: SessionStore): Observable<void> {
  if (renewalInFlight === null) {
    const used = session.refreshToken();
    if (used === null) {
      return throwError(() => new Error('No refresh token to renew the session with'));
    }
    renewalInFlight = auth.refresh({ refreshRequest: { refreshToken: used } }).pipe(
      map((tokens: TokenResponse) => {
        session.adoptTokens(tokens.accessToken, session.accountId(), tokens.refreshToken ?? used);
      }),
      catchError((failure: unknown) => {
        if (session.syncFromStorage() && session.accessToken() !== null && session.refreshToken() !== used) {
          return of(undefined);
        }
        return throwError(() => failure);
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

      // Another tab may already have renewed: then its newer access token is in localStorage.
      session.syncFromStorage();
      const newerToken = session.accessToken() !== null && session.accessToken() !== accessToken;
      return (newerToken ? of(undefined) : renewSession(auth, session)).pipe(
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