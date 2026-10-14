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
import { ChatWidget } from '../chat/chat-widget';
import { ToastContainer } from '../notifications/toast-container';
import { ThemeToggle } from '../theme/theme-toggle';
import { NavbarSearch } from '../search/navbar-search';
import { Avatar } from '../user/avatar';
import { UserProfileStore } from '../user/user-profile.store';

@Component({
  selector: 'tui-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Avatar, NavbarSearch, ThemeToggle, ToastContainer, ChatWidget],
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
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.closeMobileNav());

    this.document.addEventListener('keydown', this.onDocumentKeydown);

    this.document.addEventListener('fullscreenchange', this.onFullscreenChange);
  }

  ngOnDestroy(): void {
    this.notifications.stop();
    this.document.removeEventListener('keydown', this.onDocumentKeydown);
    this.document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.document.body.classList.remove('sidebar-minimized', 'nav-open');
  }

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

  private setMobileNav(open: boolean): void {
    this.mobileNavOpen.set(open);
    this.document.body.classList.toggle('nav-open', open);
  }

  protected toggleSidebarMinimized(): void {
    const minimized = !this.sidebarMinimized();
    this.sidebarMinimized.set(minimized);
    this.document.body.classList.toggle('sidebar-minimized', minimized);
  }

  protected toggleFullscreen(): void {
    if (!this.document.fullscreenElement) {
      void this.document.documentElement.requestFullscreen().catch(() => undefined);
    } else {
      void this.document.exitFullscreen().catch(() => undefined);
    }
  }

  protected onSignOut(): void {
    const refreshToken = this.session.refreshToken();

    if (refreshToken) {
      this.auth.logout({ refreshRequest: { refreshToken } }).subscribe({
        error: () => undefined
      });
    }

    this.session.signOut();

    void this.router.navigate(['/login']);
  }
}
