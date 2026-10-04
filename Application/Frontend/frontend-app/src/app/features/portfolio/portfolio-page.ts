import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription, forkJoin, of, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { SessionStore } from '../../core/auth/session.store';
import { NotificationStore } from '../../core/notifications/notification.store';
import { formatMoney, formatSignedMoney, formatSignedPercent } from '../../core/format/money';
import { PricedEntry, priceEntries, summarise } from '../../core/portfolio/portfolio-metrics';
import { MarketQuote, MarketService } from '../../core/services/market.service';
import { Portfolio, PortfolioService } from '../../core/services/portfolio.service';
import { AccountsService, BalanceResponse } from '../../generated/trade-client';

const REFRESH_MS = 60_000;

type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * What the account owns: every holding and intraday position, valued at the latest polled
 * price, with the gain on each and a total. Reached from the dashboard's "View portfolio" and
 * the sidebar. Selling starts from here: each row links to its ticker on the Market page.
 */
@Component({
  selector: 'tui-portfolio-page',
  imports: [RouterLink],
  templateUrl: './portfolio-page.html',
  styleUrl: './portfolio-page.css'
})
export class PortfolioPage {
  private readonly session = inject(SessionStore);
  private readonly accounts = inject(AccountsService);
  private readonly portfolioApi = inject(PortfolioService);
  private readonly marketApi = inject(MarketService);
  private readonly notifications = inject(NotificationStore);

  protected readonly formatMoney = formatMoney;
  protected readonly formatSignedMoney = formatSignedMoney;
  protected readonly formatSignedPercent = formatSignedPercent;

  protected readonly accountId = this.session.accountId;
  protected readonly state = signal<LoadState>('idle');
  protected readonly refreshFailed = signal(false);
  protected readonly updatedAt = signal<Date | null>(null);

  private readonly balance = signal<BalanceResponse | null>(null);
  private readonly portfolio = signal<Portfolio | null>(null);
  private readonly quotes = signal<MarketQuote[]>([]);

  protected readonly holdings = computed<PricedEntry[]>(() =>
    priceEntries(this.portfolio()?.holdings ?? [], 'HOLDING', this.quotes())
  );
  protected readonly positions = computed<PricedEntry[]>(() =>
    priceEntries(this.portfolio()?.positions ?? [], 'POSITION', this.quotes())
  );
  protected readonly summary = computed(() =>
    summarise(this.balance()?.cashBalance ?? 0, [...this.holdings(), ...this.positions()])
  );
  protected readonly isEmpty = computed(() => this.holdings().length === 0 && this.positions().length === 0);

  private subscription: Subscription | null = null;

  constructor() {
    effect(() => {
      const accountId = this.accountId();
      untracked(() => this.startLoading(accountId));
    });

    // An order filled or money moved: reload now rather than waiting for the minute timer.
    effect(() => {
      const changes = this.notifications.changes();
      untracked(() => {
        if (changes > 0) {
          this.startLoading(this.accountId());
        }
      });
    });
  }

  protected retry(): void {
    this.startLoading(this.accountId());
  }

  protected tone(value: number | null): string {
    return value === null || value === 0 ? '' : value > 0 ? 'text-gain' : 'text-loss';
  }

  private startLoading(accountId: number | null): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.refreshFailed.set(false);

    if (accountId === null) {
      this.state.set('idle');
      this.balance.set(null);
      this.portfolio.set(null);
      this.quotes.set([]);
      return;
    }

    // Keep showing the numbers already there while a reload is in flight.
    if (this.state() !== 'ready') {
      this.state.set('loading');
    }
    this.subscription = timer(0, REFRESH_MS)
      .pipe(
        // Failure is a value, not an error, so one dropped request does not end the refreshing.
        switchMap(() =>
          forkJoin({
            balance: this.accounts.getBalance({ id: accountId }),
            portfolio: this.portfolioApi.getPortfolio(accountId),
            quotes: this.marketApi.getQuotes()
          }).pipe(catchError(() => of(null)))
        )
      )
      .subscribe((result) => {
        if (result === null) {
          if (this.state() === 'ready') {
            this.refreshFailed.set(true);
          } else {
            this.state.set('failed');
          }
          return;
        }
        this.balance.set(result.balance);
        this.portfolio.set(result.portfolio);
        this.quotes.set(result.quotes);
        this.updatedAt.set(new Date());
        this.refreshFailed.set(false);
        this.state.set('ready');
      });
  }
}
