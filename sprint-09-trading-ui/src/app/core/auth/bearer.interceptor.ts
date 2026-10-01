import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

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
 */
export const bearerInterceptor: HttpInterceptorFn = (request, next) => {
  if (isPublicAuthEndpoint(request.url)) {
    return next(request);
  }

  const accessToken = inject(SessionStore).accessToken();
  if (accessToken === null) {
    return next(request);
  }

  return next(
    request.clone({
      setHeaders: { Authorization: `Bearer ${accessToken}` }
    })
  );
};