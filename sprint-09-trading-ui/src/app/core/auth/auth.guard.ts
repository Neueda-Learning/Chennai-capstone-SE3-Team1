import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';

import { ReturnUrlStore } from './return-url.store';
import { RETURN_URL_PARAM } from './return-url';
import { SessionStore } from './session.store';

/**
 * Keeps signed-out visitors out of the authenticated part of the app.
 *
 * This is a usability control, not a security control. The bundle is public
 * and the API is the thing that decides what a caller may do, on every call.
 * What the guard buys is that nobody lands on an empty shell with a broken
 * page inside it — a user who has been told nothing will retry, then raise a
 * ticket.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const returnUrl = inject(ReturnUrlStore);

  if (session.isSignedIn()) {
    return true;
  }

  const destination = returnUrl.capture(state.url);

  // A UrlTree, not a bare string: returning one cancels the navigation the
  // guard just refused, which is what stops the destination rendering.
  return router.createUrlTree(['/login'], {
    queryParams: { [RETURN_URL_PARAM]: destination }
  });
};

/**
 * The same check, re-run when moving between the authenticated children.
 * Without it, a session that ends while the app is open leaves the existing
 * child route standing.
 */
export const authGuardChild: CanActivateChildFn = (route) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const returnUrl = inject(ReturnUrlStore);

  if (session.isSignedIn()) {
    return true;
  }

  const destination = returnUrl.capture(
    router.serializeUrl(
      router.createUrlTree(
        route.url.map((segment) => segment.path),
        {
          queryParams: route.queryParams
        }
      )
    )
  );

  return router.createUrlTree(['/login'], {
    queryParams: { [RETURN_URL_PARAM]: destination }
  });
};
