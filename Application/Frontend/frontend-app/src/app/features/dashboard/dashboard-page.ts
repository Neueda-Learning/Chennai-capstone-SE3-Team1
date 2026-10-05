import { AfterViewInit, Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import ApexCharts from 'apexcharts';
import type { ApexOptions } from 'apexcharts';
import { Subscription, forkJoin, of, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { SessionStore } from '../../core/auth/session.store';
import { NotificationStore } from '../../core/notifications/notification.store';
import { chartPalette } from '../../core/charts/chart-theme';
import { formatMoney, formatMoneyWhole, formatSignedMoney, formatSignedPercent } from '../../core/format/money';
import {
  OrderFlow,
  PricedEntry,
  bucketOrders,
  countOrders,
  orderValue,
  priceEntries,
  summarise
} from '../../core/portfolio/portfolio-metrics';
import { MarketQuote, MarketService } from '../../core/services/market.service';
import { Portfolio, PortfolioService } from '../../core/services/portfolio.service';
import { ThemeService } from '../../core/theme/theme.service';
import { AccountsService, BalanceResponse, OrderHistoryEntry } from '../../generated/trade-client';

const FONT = 'Plus Jakarta Sans, sans-serif';
const REFRESH_MS = 60_000;
const RECENT_ORDERS = 5;

type LoadState = 'idle' | 'loading' | 'ready' | 'failed';
type RangeDays = 7 | 30 | 90;

/**
 * The home screen: everything on it is computed from the signed-in account's real data - the
 * wallet balance, the portfolio, the order history and the latest polled quotes - and refreshed
 * once a minute, which is how often the quotes themselves change.
 */
@Component({
  selector: 'tui-dashboard-page',
  imports: [RouterLink],
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

  private readonly orderFlowChartEl = viewChild.required<ElementRef<HTMLElement>>('orderFlowChart');
  private readonly allocationChartEl = viewChild.required<ElementRef<HTMLElement>>('allocationChart');

  protected readonly formatMoney = formatMoney;
  protected readonly formatMoneyWhole = formatMoneyWhole;
  protected readonly formatSignedMoney = formatSignedMoney;
  protected readonly formatSignedPercent = formatSignedPercent;
  protected readonly orderValue = orderValue;

  protected readonly accountId = this.session.accountId;
  protected readonly state = signal<LoadState>('idle');
  /** A refresh failed after data had already loaded; what is shown is the last good answer. */
  protected readonly refreshFailed = signal(false);

  protected readonly rangeOptions: readonly { label: string; days: RangeDays }[] = [
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 30 days', days: 30 },
    { label: 'Last 90 days', days: 90 }
  ];
  protected readonly rangeDays = signal<RangeDays>(30);

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
  protected readonly counts = computed(() => countOrders(this.orders()));
  protected readonly recentOrders = computed(() => this.orders().slice(0, RECENT_ORDERS));

  protected readonly orderFlow = computed<OrderFlow>(() =>
    bucketOrders(this.orders(), this.rangeDays(), new Date())
  );
  protected readonly orderFlowTotal = computed(
    () => this.orderFlow().buys.reduce((a, b) => a + b, 0) + this.orderFlow().sells.reduce((a, b) => a + b, 0)
  );

  /** Allocation slices: each holding by value, then cash. Shorts do not count towards allocation. */
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

  private orderFlowChart: ApexCharts | null = null;
  private allocationChart: ApexCharts | null = null;
  private refreshSubscription: Subscription | null = null;

  constructor() {
    // Load whenever the account becomes known, then keep it fresh. Restarting on an account
    // change (a bank account being linked swaps the token) drops the old subscription.
    effect(() => {
      const accountId = this.accountId();
      untracked(() => this.startLoading(accountId));
    });

    // Something happened to the account (an order filled, money moved): reload now rather
    // than waiting for the minute timer.
    effect(() => {
      const changes = this.notifications.changes();
      untracked(() => {
        if (changes > 0) {
          this.startLoading(this.accountId());
        }
      });
    });

    // Redraw the charts when their data or the theme changes.
    effect(() => {
      this.orderFlow();
      this.allocation();
      this.summary();
      this.theme.isDark();
      untracked(() => this.syncCharts());
    });
  }

  ngAfterViewInit(): void {
    this.orderFlowChart = new ApexCharts(this.orderFlowChartEl().nativeElement, this.orderFlowOptions());
    this.allocationChart = new ApexCharts(this.allocationChartEl().nativeElement, this.allocationOptions());
    void this.orderFlowChart.render();
    void this.allocationChart.render();
  }

  ngOnDestroy(): void {
    this.refreshSubscription?.unsubscribe();
    this.orderFlowChart?.destroy();
    this.allocationChart?.destroy();
  }

  protected setRange(days: string): void {
    this.rangeDays.set(Number(days) as RangeDays);
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

  /** Width of a progress bar, as a share of all orders. */
  protected share(count: number): number {
    const total = this.counts().total;
    return total === 0 ? 0 : Math.round((count / total) * 100);
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

    // Keep showing the numbers already there while a reload is in flight.
    if (this.state() !== 'ready') {
      this.state.set('loading');
    }
    this.refreshSubscription = timer(0, REFRESH_MS)
      .pipe(
        // A failed cycle is answered with null, not allowed to error: an error would end the
        // timer, and one dropped request would then stop the dashboard refreshing for good.
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
          // Nothing ever loaded: a plain failure. Otherwise keep what is on screen and say
          // it may be out of date.
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
    this.orderFlowChart?.updateOptions(this.orderFlowOptions(), false, false);
    this.allocationChart?.updateOptions(this.allocationOptions(), false, false);
  }

  private orderFlowOptions(): ApexOptions {
    const palette = chartPalette(this.theme.isDark());
    const flow = this.orderFlow();
    return {
      series: [
        { name: 'Buys', data: flow.buys },
        { name: 'Sells', data: flow.sells }
      ],
      chart: {
        type: 'bar',
        height: 220,
        stacked: false,
        toolbar: { show: false },
        zoom: { enabled: false },
        fontFamily: FONT,
        foreColor: palette.fore,
        background: 'transparent'
      },
      colors: [palette.primary, palette.secondary],
      states: { hover: { filter: { type: 'none' } } },
      plotOptions: { bar: { horizontal: false, columnWidth: '48%', borderRadius: 0 } },
      dataLabels: { enabled: false },
      stroke: { show: true, width: 2, colors: ['transparent'] },
      legend: { show: false },
      grid: {
        borderColor: palette.grid,
        strokeDashArray: 4,
        yaxis: { lines: { show: true } },
        xaxis: { lines: { show: false } },
        padding: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      xaxis: {
        categories: flow.categories,
        labels: { style: { colors: palette.fore, fontSize: '11px', fontWeight: 500 } },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: { labels: { show: false }, min: 0 },
      fill: { opacity: 1 },
      noData: { text: 'No orders in this range', style: { color: palette.fore } },
      tooltip: { y: { formatter: (value: number) => `${value} order${value === 1 ? '' : 's'}` }, theme: palette.tooltip }
    };
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
