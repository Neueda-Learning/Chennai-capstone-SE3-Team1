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

/**
 * The only auth-domain endpoints the contract leaves unauthenticated
 * (`security: []`); everything else - the Trade REST API, `/auth/logout`,
 * `/auth/me` - verifies the bearer token. Looking up the path is deliberate:
 * the generated clients set no flag on the request, so the skip-list is the
 * contract, and matching the path keeps the check where the contract lives.
 *
 * `/auth/refresh` being on this list is what makes the renewal below safe: the
 * refresh call carries no Authorization header and, because it leaves through
 * this same interceptor, its own 401 can never start another renewal.
 */
const PUBLIC_AUTH_ENDPOINTS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/verify-otp',
  '/auth/forgot-password',
  '/auth/resend-otp',
  '/auth/reset-password',
];

/** Whether the request targets one of the endpoints that must stay anonymous. */
function isPublicAuthEndpoint(url: string): boolean {
  const path = url.split('?')[0];
  return PUBLIC_AUTH_ENDPOINTS.some(
    (endpoint) => path === endpoint || path.endsWith(endpoint)
  );
}

/**
 * The renewal in progress, shared by every request that 401s while it runs.
 * Module scope on purpose: two 401s arriving in the same tick must not each
 * start a refresh, and the interceptor has no per-request place to hang shared
 * state. `shareReplay` keeps the second caller on the first call's result.
 *
 * This matters for correctness, not just efficiency. `/auth/refresh` rotates:
 * the service revokes the presented token and stores a new one, and presenting
 * an already-spent token is treated as theft and revokes every session the user
 * has (`auth.service.ts`). Concurrent renewals would spend the token the first
 * call just issued and trip that detector, logging the trader out.
 */
let renewalInFlight: Observable<TokenResponse> | null = null;

/**
 * Trades the stored refresh token for a new pair, or joins the renewal already
 * running. The caller has already established that a refresh token exists.
 */
function renewOnce(auth: AuthService, session: SessionStore): Observable<TokenResponse> {
  if (renewalInFlight === null) {
    const refreshToken = session.refreshToken();
    if (refreshToken === null) {
      return throwError(() => new Error('No refresh token to renew the session with'));
    }
    renewalInFlight = auth.refresh({ refreshRequest: { refreshToken } }).pipe(
      map((tokens) => {
        // The service rotates, so the replacement is nearly always present;
        // keeping the old one if it somehow is not avoids dropping a usable
        // session over a missing field.
        session.adoptTokens(
          tokens.accessToken,
          session.accountId(),
          tokens.refreshToken ?? refreshToken
        );
        return tokens;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
      // Released as soon as it settles, either way, so a later 401 can start a
      // fresh renewal instead of replaying this one's stale outcome.
      finalize(() => {
        renewalInFlight = null;
      })
    );
  }
  return renewalInFlight;
}

/**
 * Ends the session and returns the failure that ended it, so the caller still
 * sees the error its component wants to render.
 */
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

/**
 * Attaches the session's access token as `Authorization: Bearer <token>` on
 * every call except the publicly registered auth routes, which must not carry it
 * (an unauthenticated session factory with its own bearer header is exactly the
 * kind of bypass the contract pages against). With no session the request goes
 * out untouched and the API's own 401 is the answer.
 *
 * The token is read fresh on every request from the one place allowed to hold
 * it; a sign-out between scheduling and dispatch simply omits the header.
 *
 * The access token lives 15 minutes and the session is expected to outlive that,
 * so a 401 is treated as "renew and retry once" rather than "signed out". Two
 * 401s together produce one renewal (see {@link renewOnce}) and one retry each.
 * A retried request that still comes back 401 has been refused for a reason the
 * renewal cannot fix - a revoked or tampered token - and only then does the
 * session end. A failure that is not a 401, including a 500 from the retry,
 * travels to the component untouched: a flaky network must not sign anyone out.
 */
export const bearerInterceptor: HttpInterceptorFn = (request, next) => {
  if (isPublicAuthEndpoint(request.url)) {
    return next(request);
  }

  const session = inject(SessionStore);
  const router = inject(Router);
  // Resolved here, not inside the `catchError` below: `inject` is only valid
  // while the interceptor function itself is executing, not once RxJS calls back.
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

      // Nothing to renew with: the session is spent, so end it rather than
      // handing the caller a renewal error it cannot act on.
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