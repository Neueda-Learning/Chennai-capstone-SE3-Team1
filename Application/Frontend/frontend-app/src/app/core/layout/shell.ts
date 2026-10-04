import { DOCUMENT } from '@angular/common';
import { Component, OnDestroy, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { SessionStore } from '../auth/session.store';
import { AuthService } from '../../generated/auth-client';
import {
  NotificationStore,
  notificationStyle,
  timeAgo
} from '../notifications/notification.store';
import { ToastContainer } from '../notifications/toast-container';
import { ThemeToggle } from '../theme/theme-toggle';
import { NavbarSearch } from '../search/navbar-search';
import { Avatar } from '../user/avatar';
import { UserProfileStore } from '../user/user-profile.store';

@Component({
  selector: 'tui-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Avatar, NavbarSearch, ThemeToggle, ToastContainer],
  templateUrl: './shell.html',
  styleUrl: './shell.css'
})
export class Shell implements OnInit, OnDestroy {
  private readonly document = inject(DOCUMENT);
  protected readonly session = inject(SessionStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly profile = inject(UserProfileStore);
  protected readonly notifications = inject(NotificationStore);
  protected readonly notificationStyle = notificationStyle;
  protected readonly timeAgo = timeAgo;

  protected readonly mobileNavOpen = signal(false);
  protected readonly sidebarMinimized = signal(false);
  protected readonly isFullscreen = signal(false);

  constructor() {
    // Who is signed in, and what has happened to their account, follow the session: a sign-in
    // (or a bank account being linked, which swaps the token and so the account) starts both,
    // a sign-out stops them. The calls run untracked so only the session drives this.
    effect(() => {
      const signedIn = this.session.isSignedIn();
      const accountId = this.session.accountId();
      untracked(() => {
        if (!signedIn) {
          this.profile.clear();
          this.notifications.stop();
          return;
        }
        this.profile.load(accountId);
        if (accountId === null) {
          this.notifications.stop();
        } else {
          this.notifications.start(accountId);
        }
      });
    });
  }

  ngOnInit(): void {
    // A drawer that survives the navigation it was opened for is a drawer covering the page
    // somebody just asked for, so every completed navigation closes it. Escape does the same
    // for anyone whose keyboard is already on the links.
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.closeMobileNav());

    this.document.addEventListener('keydown', this.onDocumentKeydown);

    // The fullscreen buttons are not the only way in or out - Escape and F11 both leave, and
    // neither goes through toggleFullscreen, so without this the icon lies after the user
    // leaves with the keyboard.
    this.document.addEventListener('fullscreenchange', this.onFullscreenChange);
  }

  ngOnDestroy(): void {
    this.notifications.stop();
    this.document.removeEventListener('keydown', this.onDocumentKeydown);
    this.document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    // These are classes on <body>, not on this component, so nothing else takes them off.
    // Signing out destroys the shell, and the next one would come up 80px narrower, or with a
    // scroll lock nobody is left to release.
    this.document.body.classList.remove('sidebar-minimized', 'nav-open');
  }

  /** Escape closes the drawer, but only while it is the thing that is open. */
  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.mobileNavOpen()) {
      this.closeMobileNav();
    }
  };

  private readonly onFullscreenChange = (): void => {
    this.isFullscreen.set(this.document.fullscreenElement !== null);
  };

  protected toggleMobileNav(): void {
    this.setMobileNav(!this.mobileNavOpen());
  }

  protected closeMobileNav(): void {
    this.setMobileNav(false);
  }

  /** The one place the drawer's open state changes, so the scroll lock cannot drift from it. */
  private setMobileNav(open: boolean): void {
    this.mobileNavOpen.set(open);
    // Scrolling the page behind an open drawer scrolls the drawer with it on touch devices,
    // which is how people end up looking at a page they thought they had dismissed.
    this.document.body.classList.toggle('nav-open', open);
  }

  protected toggleSidebarMinimized(): void {
    const minimized = !this.sidebarMinimized();
    this.sidebarMinimized.set(minimized);
    this.document.body.classList.toggle('sidebar-minimized', minimized);
  }

  protected toggleFullscreen(): void {
    // The state is left to the fullscreenchange listener: a request can be refused, and the
    // user can leave with Escape or F11 without ever coming through here.
    if (!this.document.fullscreenElement) {
      void this.document.documentElement.requestFullscreen().catch(() => undefined);
    } else {
      void this.document.exitFullscreen().catch(() => undefined);
    }
  }

  protected onSignOut(): void {
    const refreshToken = this.session.refreshToken();

    if (refreshToken) {
      // /auth/logout is authenticated, so the revoke has to leave while the access token is still
      // in the session: the bearer interceptor reads it when the request is subscribed, which is
      // synchronous, so the local sign-out right after cannot race it. Best effort - a refusal
      // or a dead network must not keep someone signed in.
      this.auth.logout({ refreshRequest: { refreshToken } }).subscribe({
        error: () => undefined
      });
    }

    this.session.signOut();

    void this.router.navigate(['/login']);
  }
}
