import { AfterViewInit, Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import ApexCharts from 'apexcharts';
import type { ApexOptions } from 'apexcharts';
import { Subscription, forkJoin, of, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { SessionStore } from '../../core/auth/session.store';
import { NotificationStore } from '../../core/notifications/notification.store';
import { chartPalette } from '../../core/charts/chart-theme';
import { formatMoney, formatMoneyWhole, formatSignedMoney, formatSignedPercent } from '../../core/format/money';
import { PricedEntry, orderValue, priceEntries, summarise } from '../../core/portfolio/portfolio-metrics';
import { MarketQuote, MarketService } from '../../core/services/market.service';
import { Portfolio, PortfolioService } from '../../core/services/portfolio.service';
import { ThemeService } from '../../core/theme/theme.service';
import { WatchlistStore } from '../../core/watchlists/watchlist.store';
import { AdviceIdeas } from '../../shared/advice-ideas/advice-ideas';
import { AlertList } from '../../shared/alert-list/alert-list';
import { SymbolPicker } from '../../shared/symbol-picker/symbol-picker';
import { WatchlistCard } from '../../shared/watchlist-card/watchlist-card';
import { InstrumentCatalog } from '../../core/services/instrument-catalog.service';
import { Watchlist } from '../../core/services/watchlist.service';
import { AccountsService, BalanceResponse, OrderHistoryEntry } from '../../generated/trade-client';

const FONT = 'Plus Jakarta Sans, sans-serif';
const REFRESH_MS = 60_000;
const RECENT_ORDERS = 5;
/** Alerts shown on the dashboard; the rest are one click away on the Watchlists page. */
const DASHBOARD_ALERTS = 4;

type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

@Component({
  selector: 'tui-dashboard-page',
  imports: [RouterLink, WatchlistCard, AlertList, SymbolPicker, AdviceIdeas],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css'
})
export class DashboardPage implements AfterViewInit, OnDestroy {
  private readonly session = inject(SessionStore);
  private readonly accounts = inject(AccountsService);
  private readonly portfolioApi = inject(PortfolioService);
  private readonly marketApi = inject(MarketService);
  private readonly theme = inject(ThemeService);
  private readonly notifications = inject(NotificationStore);
  private readonly router = inject(Router);
  protected readonly store = inject(WatchlistStore);
  protected readonly catalog = inject(InstrumentCatalog);

  private readonly allocationChartEl = viewChild.required<ElementRef<HTMLElement>>('allocationChart');

  protected readonly formatMoney = formatMoney;
  protected readonly formatMoneyWhole = formatMoneyWhole;
  protected readonly formatSignedMoney = formatSignedMoney;
  protected readonly formatSignedPercent = formatSignedPercent;
  protected readonly orderValue = orderValue;

  protected readonly accountId = this.session.accountId;
  protected readonly state = signal<LoadState>('idle');
  protected readonly refreshFailed = signal(false);

  private readonly balance = signal<BalanceResponse | null>(null);
  private readonly portfolio = signal<Portfolio | null>(null);
  private readonly quotes = signal<MarketQuote[]>([]);
  protected readonly orders = signal<OrderHistoryEntry[]>([]);

  protected readonly entries = computed<PricedEntry[]>(() => {
    const portfolio = this.portfolio();
    if (portfolio === null) {
      return [];
    }
    return [
      ...priceEntries(portfolio.holdings, 'HOLDING', this.quotes()),
      ...priceEntries(portfolio.positions, 'POSITION', this.quotes())
    ];
  });

  protected readonly summary = computed(() => summarise(this.balance()?.cashBalance ?? 0, this.entries()));
  protected readonly recentOrders = computed(() => this.orders().slice(0, RECENT_ORDERS));

  protected readonly dashboardAlerts = DASHBOARD_ALERTS;
  /** Which watchlist the dashboard is showing, when there are several. Defaults to the first. */
  protected readonly activeListId = signal<string | null>(null);
  protected readonly activeList = computed<Watchlist | null>(() => {
    const lists = this.store.watchlists();
    return lists.find((list) => list.id === this.activeListId()) ?? lists[0] ?? null;
  });
  protected readonly newWatchlistName = signal('');
  protected readonly alertPick = signal<string[]>([]);
  /** Latest price per symbol, for how far each alert is from its level. */
  protected readonly prices = computed(() => Object.fromEntries(this.quotes().map((quote) => [quote.symbol, quote.price])));

  protected readonly allocation = computed(() => {
    const palette = chartPalette(this.theme.isDark());
    const slices = this.entries()
      .filter((entry) => entry.value > 0)
      .map((entry) => ({ label: entry.symbol, value: entry.value }));
    const cash = this.summary().cash;
    if (cash > 0) {
      slices.push({ label: 'Cash', value: cash });
    }
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    return slices.map((slice, index) => ({
      ...slice,
      percent: total > 0 ? (slice.value / total) * 100 : 0,
      color: palette.slices[index % palette.slices.length]
    }));
  });

  protected readonly headline = computed(() => {
    const summary = this.summary();
    if (this.entries().length === 0) {
      return 'No holdings yet. Pick a ticker on the Market page to place your first order.';
    }
    if (summary.unrealisedPercent === null) {
      return 'Your portfolio is valued at the latest polled prices.';
    }
    const direction = summary.unrealised >= 0 ? 'up' : 'down';
    return `Your holdings are ${direction} ${Math.abs(summary.unrealisedPercent).toFixed(2)}% on what you paid.`;
  });

  private allocationChart: ApexCharts | null = null;
  private refreshSubscription: Subscription | null = null;

  constructor() {
    this.store.start();
    effect(() => {
      const accountId = this.accountId();
      untracked(() => {
        this.startLoading(accountId);
        if (accountId !== null) {
          this.catalog.ensureLoaded();
        }
      });
    });

    effect(() => {
      const changes = this.notifications.changes();
      untracked(() => {
        if (changes > 0) {
          this.startLoading(this.accountId());
        }
      });
    });

    effect(() => {
      this.allocation();
      this.summary();
      this.theme.isDark();
      untracked(() => this.syncCharts());
    });
  }

  ngAfterViewInit(): void {
    this.allocationChart = new ApexCharts(this.allocationChartEl().nativeElement, this.allocationOptions());
    void this.allocationChart.render();
  }

  ngOnDestroy(): void {
    this.refreshSubscription?.unsubscribe();
    this.allocationChart?.destroy();
    this.store.stop();
  }

  protected selectList(id: string): void {
    this.activeListId.set(id);
  }

  protected setWatchlistName(event: Event): void {
    this.newWatchlistName.set((event.target as HTMLInputElement).value);
  }

  protected createWatchlist(): void {
    this.store.createWatchlist(this.newWatchlistName()).subscribe((ok) => {
      if (ok) {
        this.newWatchlistName.set('');
      }
    });
  }

  /** Picking a stock to alert on opens its chart on the Watchlists page, where the alert is placed. */
  protected chooseAlertStock(symbols: string[]): void {
    this.alertPick.set([]);
    if (symbols[0]) {
      void this.router.navigate(['/app/watchlists'], { queryParams: { alert: symbols[0] } });
    }
  }

  protected retry(): void {
    this.startLoading(this.accountId());
  }

  protected iconFor(order: OrderHistoryEntry): string {
    return order.side === 'BUY' ? 'bi-arrow-up-circle' : 'bi-arrow-down-circle';
  }

  protected formatWhen(createdOn: string): string {
    const date = new Date(createdOn);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return (
      date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' • ' +
      date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    );
  }

  protected trendClass(value: number | null): string {
    return value === null || value === 0 ? 'trend-flat' : value > 0 ? 'trend-up' : 'trend-down';
  }

  private startLoading(accountId: number | null): void {
    this.refreshSubscription?.unsubscribe();
    this.refreshSubscription = null;
    this.refreshFailed.set(false);

    if (accountId === null) {
      this.state.set('idle');
      this.balance.set(null);
      this.portfolio.set(null);
      this.orders.set([]);
      this.quotes.set([]);
      return;
    }

    if (this.state() !== 'ready') {
      this.state.set('loading');
    }
    this.refreshSubscription = timer(0, REFRESH_MS)
      .pipe(
        switchMap(() =>
          forkJoin({
            balance: this.accounts.getBalance({ id: accountId }),
            portfolio: this.portfolioApi.getPortfolio(accountId),
            orders: this.accounts.getOrders({ id: accountId }),
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
        this.orders.set(
          [...result.orders].sort((a, b) => new Date(b.createdOn).getTime() - new Date(a.createdOn).getTime())
        );
        this.quotes.set(result.quotes);
        this.refreshFailed.set(false);
        this.state.set('ready');
      });
  }

  private syncCharts(): void {
    this.allocationChart?.updateOptions(this.allocationOptions(), false, false);
  }

  private allocationOptions(): ApexOptions {
    const palette = chartPalette(this.theme.isDark());
    const slices = this.allocation();
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    return {
      series: slices.map((slice) => Math.round(slice.value * 100) / 100),
      chart: { type: 'donut', height: 250, fontFamily: FONT, foreColor: palette.fore, background: 'transparent' },
      labels: slices.map((slice) => slice.label),
      colors: slices.map((slice) => slice.color),
      stroke: { show: true, width: 2, colors: [this.theme.isDark() ? '#101a15' : '#ffffff'] },
      states: { hover: { filter: { type: 'none' } } },
      legend: { show: false },
      dataLabels: { enabled: false },
      noData: { text: 'Nothing to allocate yet', style: { color: palette.fore } },
      plotOptions: {
        pie: {
          donut: {
            size: '72%',
            background: 'transparent',
            labels: {
              show: true,
              name: { show: true, fontSize: '12px', fontWeight: 500, color: palette.fore, offsetY: -8 },
              value: {
                show: true,
                fontSize: '22px',
                fontWeight: 800,
                color: palette.strong,
                offsetY: 8,
                formatter: (value: string) => `${Number(value) ? ((Number(value) / (total || 1)) * 100).toFixed(1) : '0.0'}%`
              },
              total: {
                show: true,
                label: 'Portfolio Value',
                fontSize: '11px',
                fontWeight: 500,
                color: palette.fore,
                formatter: () => formatMoneyWhole(this.summary().totalValue)
              }
            }
          }
        }
      },
      tooltip: { theme: palette.tooltip, y: { formatter: (value: number) => formatMoney(value) } }
    };
  }
}
