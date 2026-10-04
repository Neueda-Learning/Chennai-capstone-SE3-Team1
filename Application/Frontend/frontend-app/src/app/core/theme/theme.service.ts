import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, computed, effect, inject, signal } from '@angular/core';

export type ThemeName = 'light' | 'dark';

/** Where the chosen theme is remembered between visits. */
export const THEME_STORAGE_KEY = 'trading-ui.theme';

/** The storage the choice is kept in; injectable so specs do not touch the real one. */
export const THEME_STORAGE = new InjectionToken<Storage>('Storage for the chosen theme', {
  factory: () => localStorage
});

/**
 * The one place the light/dark choice lives.
 *
 * The choice is applied as Bootstrap 5.3's `data-bs-theme` attribute on `<html>`, which both
 * Bootstrap's own components and the dark block in `spark-admin.css` key off. A visitor who has
 * never chosen gets their operating system's preference; an explicit choice always wins and is
 * remembered. `index.html` applies the stored choice before the app boots so the page never
 * flashes light first.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly storage = inject(THEME_STORAGE);

  private readonly current = signal<ThemeName>(this.initialTheme());

  readonly theme = this.current.asReadonly();
  readonly isDark = computed(() => this.current() === 'dark');

  constructor() {
    effect(() => {
      this.document.documentElement.setAttribute('data-bs-theme', this.current());
    });
  }

  toggle(): void {
    this.set(this.current() === 'dark' ? 'light' : 'dark');
  }

  set(theme: ThemeName): void {
    this.current.set(theme);
    try {
      this.storage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable (private browsing); the choice still holds for this tab.
    }
  }

  private initialTheme(): ThemeName {
    try {
      const stored = this.storage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
    } catch {
      // fall through to the system preference
    }
    const prefersDark = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
}
