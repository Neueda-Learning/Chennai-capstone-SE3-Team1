import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';

import { ReturnUrlStore } from './return-url.store';
import { RETURN_URL_PARAM } from './return-url';
import { SessionStore } from './session.store';

export const authGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const returnUrl = inject(ReturnUrlStore);

  if (session.isSignedIn()) {
    return true;
  }

  const destination = returnUrl.capture(state.url);

  return router.createUrlTree(['/login'], {
    queryParams: { [RETURN_URL_PARAM]: destination }
  });
};

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
