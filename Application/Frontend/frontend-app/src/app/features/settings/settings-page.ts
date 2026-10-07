import { Component, inject, signal } from '@angular/core';

import { SessionStore } from '../../core/auth/session.store';
import { ErrorCatalog } from '../../core/errors/error-catalog';
import { NotificationStore } from '../../core/notifications/notification.store';
import { ChannelKind, PreferencesService } from '../../core/services/preferences.service';
import { ThemeName, ThemeService } from '../../core/theme/theme.service';
import { NotificationHistoryCard } from './notification-history-card';

@Component({
  selector: 'tui-settings-page',
  imports: [NotificationHistoryCard],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css'
})
export class SettingsPage {
  protected readonly theme = inject(ThemeService);
  protected readonly notifications = inject(NotificationStore);
  private readonly preferences = inject(PreferencesService);
  private readonly session = inject(SessionStore);
  private readonly errors = inject(ErrorCatalog);

  protected readonly themes: readonly { value: ThemeName; label: string; icon: string }[] = [
    { value: 'light', label: 'Light', icon: 'bi-sun' },
    { value: 'dark', label: 'Dark', icon: 'bi-moon-stars' }
  ];

  protected readonly channels: readonly { value: ChannelKind; label: string; icon: string }[] = [
    { value: 'PUSH', label: 'In-app', icon: 'bi-bell' }
  ];

  protected readonly accountId = this.session.accountId;
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly channel = signal<ChannelKind>('PUSH');
  protected readonly notSetYet = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    const accountId = this.session.accountId();
    if (accountId === null) {
      this.loading.set(false);
      return;
    }
    this.preferences.get(accountId).subscribe({
      next: (stored) => {
        if (stored.channel !== null) {
          this.channel.set(stored.channel);
        }
        this.loading.set(false);
      },
      error: (failure) => {
        if (failure?.status === 404) {
          this.notSetYet.set(true);
        } else {
          this.error.set(this.errors.messageForTrade(failure));
        }
        this.loading.set(false);
      }
    });
  }

  protected setTheme(value: ThemeName): void {
    this.theme.set(value);
  }

  protected setPopups(event: Event): void {
    this.notifications.setPopupsEnabled((event.target as HTMLInputElement).checked);
  }

  protected setChannel(value: ChannelKind): void {
    this.channel.set(value);
    this.saved.set(false);
    this.error.set(null);
  }

  protected save(): void {
    const accountId = this.session.accountId();
    if (accountId === null || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    this.preferences.put(accountId, { defaultAccountId: accountId, channel: this.channel() }).subscribe({
      next: () => {
        this.notSetYet.set(false);
        this.saved.set(true);
        this.saving.set(false);
      },
      error: (failure) => {
        this.error.set(this.errors.messageForTrade(failure));
        this.saving.set(false);
      }
    });
  }
}
