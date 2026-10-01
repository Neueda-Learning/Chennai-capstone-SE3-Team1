import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { SessionStore } from './session.store';

/**
 * The only auth-domain endpoints the contract leaves unauthenticated
 * (`security: []`); everything else - the Trade REST API, `/auth/logout`,
 * `/auth/me` - verifies the bearer token. Looking up the path is deliberate:
 * the generated clients set no flag on the request, so the skip-list is the
 * contract, and matching the path keeps the check where the contract lives.
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
 * Attaches the session's access token as `Authorization: Bearer <token>` on
 * every call except the three publicly registered auth routes, which must not
 * carry it (an unauthenticated session factory with its own bearer header is
 * exactly the kind of bypass the contract pages against). With no session the
 * request goes out untouched and the API's own 401 is the answer.
 *
 * The token is read fresh on every request from the one place allowed to hold
 * it; a sign-out between scheduling and dispatch simply omits the header.
 * 
 * Also handles 401 Unauthorized responses by:
 * 1. Clearing the session (signOut)
 * 2. Redirecting to /login
 * 3. Allowing the error to propagate to the component for error display
 */
export const bearerInterceptor: HttpInterceptorFn = (request, next) => {
  if (isPublicAuthEndpoint(request.url)) {
    return next(request).pipe(
      catchError((error: unknown) => {
        return throwError(() => error);
      })
    );
  }

  const session = inject(SessionStore);
  const router = inject(Router);
  const accessToken = session.accessToken();
  
  if (accessToken === null) {
    return next(request).pipe(
      catchError((error: unknown) => {
        return throwError(() => error);
      })
    );
  }

  return next(
    request.clone({
      setHeaders: { Authorization: `Bearer ${accessToken}` }
    })
  ).pipe(
    catchError((error: unknown) => {
      // Handle 401 Unauthorized - session expired or token revoked
      if (error instanceof HttpErrorResponse && error.status === 401) {
        console.warn('[Auth] Received 401 Unauthorized - session expired');
        
        // Clear the session
        session.signOut();
        
        // Redirect to login page with the current URL as return destination
        router.navigate(['/login'], {
          queryParams: { returnUrl: router.url }
        });
      }
      
      // Pass the error through to the component for UI error display
      return throwError(() => error);
    })
  );
};