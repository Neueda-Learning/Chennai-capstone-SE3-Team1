import { Component, inject } from '@angular/core';

import { ThemeService } from './theme.service';

@Component({
  selector: 'tui-theme-toggle',
  template: `
    <button
      type="button"
      class="navbar-action-btn theme-toggle-btn"
      data-testid="theme-toggle"
      [attr.aria-label]="theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'"
      [attr.title]="theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'"
      [attr.aria-pressed]="theme.isDark()"
      (click)="theme.toggle()"
    >
      <i class="bi" [class.bi-moon-stars]="!theme.isDark()" [class.bi-sun]="theme.isDark()"></i>
    </button>
  `
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
}
