import { DOCUMENT } from '@angular/common';
import { Component, OnDestroy, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

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
export class Shell implements OnDestroy {
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

  ngOnDestroy(): void {
    this.notifications.stop();
  }

  protected toggleMobileNav(): void {
    this.mobileNavOpen.update((open) => !open);
  }

  protected closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }

  protected toggleSidebarMinimized(): void {
    const minimized = !this.sidebarMinimized();
    this.sidebarMinimized.set(minimized);
    this.document.body.classList.toggle('sidebar-minimized', minimized);
  }

  protected toggleFullscreen(): void {
    if (!this.document.fullscreenElement) {
      this.document.documentElement
        .requestFullscreen()
        .then(() => this.isFullscreen.set(true))
        .catch(() => this.isFullscreen.set(false));
    } else {
      this.document
        .exitFullscreen()
        .then(() => this.isFullscreen.set(false))
        .catch(() => this.isFullscreen.set(true));
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
