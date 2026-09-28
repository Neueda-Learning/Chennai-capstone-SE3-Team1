import { DOCUMENT } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'tui-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.css'
})
export class Shell {
  private readonly document = inject(DOCUMENT);

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
}
