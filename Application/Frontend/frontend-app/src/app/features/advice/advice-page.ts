import { DecimalPipe, LowerCasePipe, PercentPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { ErrorCatalog } from '../../core/errors/error-catalog';
import { Advice, AdviceService, TradeSignal, suggestionBadge } from '../../core/services/advice.service';

@Component({
  selector: 'tui-advice-page',
  imports: [DecimalPipe, LowerCasePipe, PercentPipe, RouterLink],
  templateUrl: './advice-page.html',
  styleUrl: './advice-page.css'
})
export class AdvicePage {
  private readonly advice = inject(AdviceService);
  private readonly session = inject(SessionStore);
  private readonly errors = inject(ErrorCatalog);

  protected readonly loading = signal(true);
  protected readonly data = signal<Advice | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.load();
  }

  protected load(): void {
    const accountId = this.session.accountId();
    if (accountId === null) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.advice.forAccount(accountId).subscribe({
      next: (advice) => {
        this.data.set(advice);
        this.loading.set(false);
      },
      error: (failure) => {
        this.error.set(this.errors.messageForTrade(failure));
        this.loading.set(false);
      }
    });
  }

  protected badge(signal: TradeSignal): string {
    return suggestionBadge(signal.suggestion);
  }

  protected sources(signal: TradeSignal): string {
    return signal.sources.map((source) => (source === 'HOLDING' ? 'Held' : 'Watched')).join(' · ');
  }
}
