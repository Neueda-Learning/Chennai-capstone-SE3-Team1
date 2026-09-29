import { DOCUMENT } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { SessionStore } from '../auth/session.store';
import { AuthService } from '../../generated/auth-client';

@Component({
  selector: 'tui-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.css'
})
export class Shell {
  private readonly document = inject(DOCUMENT);
  private readonly session = inject(SessionStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly mobileNavOpen = signal(false);
  protected readonly sidebarMinimized = signal(false);
  protected readonly isFullscreen = signal(false);

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
    this.session.signOut();

    if (refreshToken) {
      // Best effort: revoking the refresh token stops a lost tab from minting
      // a new access token. Until the auth interceptor story lands, this call
      // goes out anonymous and the service refuses it with AUTH-401 - and that
      // refusal is fine, because the local sign-out has already happened.
      this.auth.logout({ refreshRequest: { refreshToken } }).subscribe({
        error: () => undefined
      });
    }

    void this.router.navigate(['/login']);
  }
}
