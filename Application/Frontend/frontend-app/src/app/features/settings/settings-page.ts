import { Component, inject } from '@angular/core';

import { NotificationStore } from '../../core/notifications/notification.store';
import { ThemeName, ThemeService } from '../../core/theme/theme.service';

/** Preferences that live in this browser: the theme, and whether notifications pop up. */
@Component({
  selector: 'tui-settings-page',
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css'
})
export class SettingsPage {
  protected readonly theme = inject(ThemeService);
  protected readonly notifications = inject(NotificationStore);

  protected readonly themes: readonly { value: ThemeName; label: string; icon: string }[] = [
    { value: 'light', label: 'Light', icon: 'bi-sun' },
    { value: 'dark', label: 'Dark', icon: 'bi-moon-stars' }
  ];

  protected setTheme(value: ThemeName): void {
    this.theme.set(value);
  }

  protected setPopups(event: Event): void {
    this.notifications.setPopupsEnabled((event.target as HTMLInputElement).checked);
  }
}
