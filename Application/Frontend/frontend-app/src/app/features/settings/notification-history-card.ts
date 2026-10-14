import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';

import { SessionStore } from '../../core/auth/session.store';
import { ErrorCatalog } from '../../core/errors/error-catalog';
import {
  DeliveryStatus,
  NotificationHistoryEntry,
  NotificationHistoryService
} from '../../core/services/notification-history.service';
import { ChannelKind } from '../../core/services/preferences.service';

const PAGE_SIZE = 20;

const CHANNEL_LABEL: Record<ChannelKind, string> = { EMAIL: 'email', PUSH: 'in-app' };

@Component({
  selector: 'tui-notification-history-card',
  imports: [DatePipe],
  templateUrl: './notification-history-card.html'
})
export class NotificationHistoryCard {
  private readonly history = inject(NotificationHistoryService);
  private readonly session = inject(SessionStore);
  private readonly errors = inject(ErrorCatalog);

  protected readonly entries = signal<NotificationHistoryEntry[]>([]);
  protected readonly loading = signal(true);
  protected readonly canLoadMore = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.load();
  }

  protected loadMore(): void {
    const last = this.entries().at(-1);
    if (last !== undefined) {
      this.load(last.createdAt);
    }
  }

  protected statusText(entry: NotificationHistoryEntry): string {
    const labels: Record<DeliveryStatus, string> = {
      PENDING_CHANNEL: 'Waiting for a channel preference',
      QUEUED: entry.channel === null ? 'Sending' : `Sending by ${CHANNEL_LABEL[entry.channel]}`,
      SENT: entry.channel === null ? 'Sent' : `Sent by ${CHANNEL_LABEL[entry.channel]}`,
      FAILED: 'Could not be delivered'
    };
    return labels[entry.status];
  }

  private load(before?: string): void {
    const accountId = this.session.accountId();
    if (accountId === null) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.history.list(accountId, { limit: PAGE_SIZE, before }).subscribe({
      next: (page) => {
        this.entries.update((current) => [...current, ...page]);
        this.canLoadMore.set(page.length === PAGE_SIZE);
        this.loading.set(false);
      },
      error: (failure) => {
        this.error.set(this.errors.messageForTrade(failure));
        this.loading.set(false);
      }
    });
  }
}
