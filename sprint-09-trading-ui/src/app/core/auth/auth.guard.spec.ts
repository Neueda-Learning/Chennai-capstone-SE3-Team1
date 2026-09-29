import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  GuardResult,
  MaybeAsync,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter
} from '@angular/router';

import { authGuard, authGuardChild } from './auth.guard';
import { ReturnUrlStore } from './return-url.store';
import { RETURN_URL_PARAM } from './return-url';
import { SessionStore } from './session.store';

type GuardOutcome = MaybeAsync<GuardResult>;

function runGuard(url: string): GuardOutcome {
  return TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)
  );
}

describe('authGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('blocks an unauthenticated navigation and redirects to sign-in', () => {
    const router = TestBed.inject(Router);
    const result = runGuard('/blotter');

    expect(result).toBeInstanceOf(UrlTree);
    const tree = result as UrlTree;
    expect(router.serializeUrl(tree)).toBe('/login?returnUrl=%2Fblotter');
  });

  it('carries where the visitor was going', () => {
    const router = TestBed.inject(Router);
    const tree = runGuard('/orders?side=BUY') as UrlTree;

    expect(router.serializeUrl(tree)).toContain(`${RETURN_URL_PARAM}=`);
    expect(decodeURIComponent(router.serializeUrl(tree))).toContain('/orders?side=BUY');
  });

  it('refuses an attempted URL that is not a path on this origin', () => {
    const router = TestBed.inject(Router);
    const tree = runGuard('//evil.example/steal') as UrlTree;

    expect(router.serializeUrl(tree)).toBe('/login?returnUrl=%2Fdashboard');
  });

  it('allows an authenticated navigation through', () => {
    TestBed.inject(SessionStore).signIn('token');

    expect(runGuard('/blotter')).toBe(true);
  });

  it('blocks again once the session ends', () => {
    const session = TestBed.inject(SessionStore);
    session.signIn('token');
    expect(runGuard('/blotter')).toBe(true);

    session.signOut();

    expect(runGuard('/blotter')).toBeInstanceOf(UrlTree);
  });

  it('records the destination for the sign-in page to come back to', () => {
    runGuard('/blotter');

    expect(TestBed.inject(ReturnUrlStore).peek()).toBe('/blotter');
  });
});

describe('authGuardChild', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  function runChild(): GuardOutcome {
    return TestBed.runInInjectionContext(() =>
      authGuardChild(
        {
          url: [{ path: 'orders' }],
          queryParams: {}
        } as unknown as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot
      )
    );
  }

  it('blocks a move between authenticated children when signed out', () => {
    const router = TestBed.inject(Router);
    const tree = runChild() as UrlTree;

    expect(tree).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(tree)).toBe('/login?returnUrl=%2Forders');
  });

  it('allows the move when signed in', () => {
    TestBed.inject(SessionStore).signIn('token');

    expect(runChild()).toBe(true);
  });
});
