import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, computed, effect, inject, signal } from '@angular/core';

export type ThemeName = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'trading-ui.theme';

export const THEME_STORAGE = new InjectionToken<Storage>('Storage for the chosen theme', {
  factory: () => localStorage
});

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
    }
  }

  private initialTheme(): ThemeName {
    try {
      const stored = this.storage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
    } catch {
    }
    const prefersDark = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
}
