import { DecimalPipe, PercentPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SessionStore } from '../../core/auth/session.store';
import { Advice, AdviceService, TradeSignal, suggestionBadge } from '../../core/services/advice.service';

/** Maximum rows in each list on the dashboard; the Advice page has the rest. */
export const IDEAS_SHOWN = 4;

/**
 * The dashboard's view of the ETL analysis service: the market's strongest published suggestions and the signal
 * and next-session prediction for what the customer holds or watches. It loads itself, so a failure here never
 * holds up the rest of the dashboard.
 */
@Component({
  selector: 'tui-advice-ideas',
  imports: [DecimalPipe, PercentPipe, RouterLink],
  templateUrl: './advice-ideas.html'
})
export class AdviceIdeas {
  private readonly advice = inject(AdviceService);
  private readonly session = inject(SessionStore);

  protected readonly data = signal<Advice | null>(null);
  protected readonly failed = signal(false);

  protected readonly buy = computed(() => (this.data()?.ideas.buy ?? []).slice(0, IDEAS_SHOWN));
  protected readonly sell = computed(() => (this.data()?.ideas.sell ?? []).slice(0, IDEAS_SHOWN));
  protected readonly mine = computed(() =>
    (this.data()?.signals ?? []).filter((s) => s.status === 'OK').slice(0, IDEAS_SHOWN)
  );

  constructor() {
    const accountId = this.session.accountId();
    if (accountId === null) {
      return;
    }
    this.advice.forAccount(accountId).subscribe({
      next: (advice) => this.data.set(advice),
      error: () => this.failed.set(true)
    });
  }

  protected badge(signal: TradeSignal): string {
    return suggestionBadge(signal.suggestion);
  }
}
