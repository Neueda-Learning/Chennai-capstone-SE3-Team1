import { Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked, viewChild, AfterViewInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import ApexCharts from 'apexcharts';
import type { ApexOptions } from 'apexcharts';
import { Subscription, forkJoin, of, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { SessionStore } from '../../core/auth/session.store';
import { chartPalette } from '../../core/charts/chart-theme';
import { formatMoney, formatSignedPercent, roundToPaise } from '../../core/format/money';
import { NotificationStore } from '../../core/notifications/notification.store';
import { MarketPoint, MarketQuote, MarketService } from '../../core/services/market.service';
import { Portfolio, PortfolioService } from '../../core/services/portfolio.service';
import { ThemeService } from '../../core/theme/theme.service';
import {
  AccountResponse,
  AccountsService,
  BalanceResponse,
  OrderResponse,
  OrderSide,
  OrderStatus,
  OrdersService
} from '../../generated/trade-client';
import { OrderErrorMessages } from './order-error-messages';
import { wholeQuantity } from './order-validators';

/**
 * How far outside the current price a market order's protective limit sits. Orders here always
 * execute at the live price: the Trade API still takes a `price` with every order and files it
 * as the order's limit, so the page sends the current price padded by this much in the
 * trader's unfavourable direction. That keeps a price that moves a little between click and
 * fill from rejecting the order, while the executor still fills at the live ask (buy) or bid
 * (sell), never at the limit.
 */
export const PRICE_PROTECTION = 0.02;

const QUOTE_REFRESH_MS = 30_000;
const FONT = 'Plus Jakarta Sans, sans-serif';

type Load = 'idle' | 'loading' | 'ready' | 'failed';

interface OrderAccepted {
  kind: 'accepted';
  order: OrderResponse;
  /** What the trader asked for, to describe it without presenting the protective limit as a price. */
  summary: string;
}

interface OrderRefused {
  kind: 'refused';
  message: string;
}

type OrderOutcome = OrderAccepted | OrderRefused;

export interface ChartRange {
  label: string;
  points: number;
}

/** Messages for the rules the form blocks on its own. */
const FIELD_MESSAGES: Record<string, string> = {
  required: 'Enter how many units.',
  wholeQuantity: 'Quantity must be a whole number of units.',
  min: 'Must be greater than zero.',
  noAccount: 'No trading account is linked to this session yet.',
  noPrice: 'There is no current price for this ticker yet, so it cannot be traded.',
  notEnoughUnits: 'You cannot sell more units than you hold.',
  notEnoughCash: 'Not enough cash in your wallet for this order.'
};

/**
 * The market and the order ticket in one screen.
 *
 * Left: every tradable ticker with its latest polled price (the poller runs about once a
 * minute). Click one to chart its price history and trade it on the right. Orders carry no
 * price field and no order type: they execute at the current market price, which is shown, and
 * a sell shows how many units of the ticker can be sold.
 */
@Component({
  selector: 'tui-order-ticket-page',
  imports: [ReactiveFormsModule],
  templateUrl: './order-ticket-page.html',
  styleUrl: './order-ticket-page.css'
})
export class OrderTicketPage implements AfterViewInit, OnDestroy {
  private readonly formBuilder = inject(FormBuilder);
  private readonly orders = inject(OrdersService);
  private readonly accounts = inject(AccountsService);
  private readonly portfolioApi = inject(PortfolioService);
  private readonly marketApi = inject(MarketService);
  private readonly session = inject(SessionStore);
  private readonly errorMessages = inject(OrderErrorMessages);
  private readonly notifications = inject(NotificationStore);
  private readonly theme = inject(ThemeService);
  private readonly route = inject(ActivatedRoute, { optional: true });

  private readonly chartEl = viewChild.required<ElementRef<HTMLElement>>('priceChart');

  protected readonly formatMoney = formatMoney;
  protected readonly formatSignedPercent = formatSignedPercent;

  protected readonly protectionPercent = PRICE_PROTECTION * 100;
  protected readonly side = signal<OrderSide>('BUY');
  protected readonly submitting = signal(false);
  protected readonly outcome = signal<OrderOutcome | null>(null);

  protected readonly quotes = signal<MarketQuote[]>([]);
  protected readonly quotesState = signal<Load>('idle');
  protected readonly selectedSymbol = signal<string | null>(null);

  protected readonly ranges: readonly ChartRange[] = [
    { label: '1H', points: 60 },
    { label: '3H', points: 180 },
    { label: '8H', points: 480 }
  ];
  protected readonly range = signal<ChartRange>(this.ranges[1]);
  protected readonly history = signal<MarketPoint[]>([]);
  protected readonly historyState = signal<Load>('idle');

  protected readonly balance = signal<BalanceResponse | null>(null);
  protected readonly balanceState = signal<Load>('idle');
  protected readonly account = signal<AccountResponse | null>(null);
  protected readonly accountState = signal<Load>('idle');
  private readonly portfolio = signal<Portfolio | null>(null);

  /** The account comes from the token, so it is shown and never offered as a field. */
  protected readonly accountId = this.session.accountId;
  protected readonly hasAccount = computed(() => this.accountId() !== null);

  protected readonly form = this.formBuilder.nonNullable.group({
    quantity: this.formBuilder.nonNullable.control('', [wholeQuantity])
  });
  private readonly quantityText = signal('');

  protected readonly selected = computed(
    () => this.quotes().find((quote) => quote.symbol === this.selectedSymbol()) ?? null
  );

  /** The price the order executes at, as far as anyone can know before it fills. */
  protected readonly currentPrice = computed(() => this.selected()?.price ?? null);

  /** Units of the selected ticker that can be sold: the holding the API checks a sell against. */
  protected readonly unitsAvailable = computed(() => {
    const symbol = this.selectedSymbol();
    return this.portfolio()?.holdings.find((holding) => holding.symbol === symbol)?.quantity ?? 0;
  });

  protected readonly quantity = computed(() => {
    const text = this.quantityText().trim();
    return /^\d+$/.test(text) ? Number(text) : null;
  });

  /** The side's reference price: buys fill at the ask, sells at the bid. */
  private readonly referencePrice = computed(() => {
    const quote = this.selected();
    if (quote === null || quote.price === null) {
      return null;
    }
    return (this.side() === 'BUY' ? quote.ask : quote.bid) ?? quote.price;
  });

  /** The protective limit sent with the order. See {@link PRICE_PROTECTION}. */
  protected readonly protectedLimit = computed(() => {
    const reference = this.referencePrice();
    if (reference === null) {
      return null;
    }
    const limit =
      this.side() === 'BUY'
        ? Math.ceil(reference * (1 + PRICE_PROTECTION) * 100) / 100
        : Math.floor(reference * (1 - PRICE_PROTECTION) * 100) / 100;
    return Math.max(limit, 0.01);
  });

  protected readonly estimatedTotal = computed(() => {
    const quantity = this.quantity();
    const price = this.currentPrice();
    return quantity !== null && quantity > 0 && price !== null ? roundToPaise(quantity * price) : null;
  });

  /** The most a buy can reserve: the quantity at the protective limit, which the API checks the wallet against. */
  private readonly maxBuyCost = computed(() => {
    const quantity = this.quantity();
    const limit = this.protectedLimit();
    return quantity !== null && quantity > 0 && limit !== null ? roundToPaise(quantity * limit) : null;
  });

  /** The reason the order cannot be sent yet, if there is one. Shown under the quantity. */
  protected readonly blocker = computed<string | null>(() => {
    if (!this.hasAccount()) {
      return FIELD_MESSAGES['noAccount'];
    }
    if (this.currentPrice() === null) {
      return FIELD_MESSAGES['noPrice'];
    }
    const quantity = this.quantity();
    if (quantity === null || quantity <= 0) {
      return null; // the form's own validation speaks for an empty or malformed quantity
    }
    if (this.side() === 'SELL' && quantity > this.unitsAvailable()) {
      return FIELD_MESSAGES['notEnoughUnits'];
    }
    const maxCost = this.maxBuyCost();
    const cash = this.balance()?.cashBalance;
    if (this.side() === 'BUY' && maxCost !== null && cash !== undefined && maxCost > cash) {
      return FIELD_MESSAGES['notEnoughCash'];
    }
    return null;
  });

  private chart: ApexCharts | null = null;
  private quotesSubscription: Subscription | null = null;
  private preferredSymbol: string | null = this.route?.snapshot?.queryParamMap?.get('symbol') ?? null;
  private historyRequest: Subscription | null = null;

  constructor() {
    // A type="number" input hands the form a number once it parses, so normalise to text.
    // The navbar search (and the portfolio's Trade buttons) link here with ?symbol=. This page is
    // already open when that happens from the market screen itself, so follow the URL, not just
    // its value at creation.
    this.route?.queryParamMap?.pipe(takeUntilDestroyed()).subscribe((params) => {
      const wanted = params.get('symbol');
      if (wanted === null) {
        return;
      }
      this.preferredSymbol = wanted;
      if (this.quotes().some((quote) => quote.symbol === wanted)) {
        this.select(wanted);
      }
    });

    this.form.controls.quantity.valueChanges.subscribe((value) => this.quantityText.set(String(value ?? '')));

    // Quotes are account-independent, so they load for as long as the page is open.
    this.startQuotePolling();

    // The wallet card, the sell limit and the linked bank follow the account.
    effect(() => {
      const accountId = this.accountId();
      untracked(() => this.loadAccountData(accountId));
    });

    // An order fills (or is refused) a few seconds after it is accepted, and that is when the
    // cash and the units held actually move, so reload them when the notification arrives.
    effect(() => {
      const changes = this.notifications.changes();
      untracked(() => {
        if (changes > 0) {
          this.loadAccountData(this.accountId());
        }
      });
    });

    // The chart follows the selected ticker, the range and the theme.
    effect(() => {
      const symbol = this.selectedSymbol();
      const range = this.range();
      untracked(() => this.loadHistory(symbol, range.points));
    });
    effect(() => {
      this.history();
      this.theme.isDark();
      untracked(() => this.syncChart());
    });
  }

  ngAfterViewInit(): void {
    this.chart = new ApexCharts(this.chartEl().nativeElement, this.chartOptions());
    void this.chart.render();
  }

  ngOnDestroy(): void {
    this.quotesSubscription?.unsubscribe();
    this.historyRequest?.unsubscribe();
    this.chart?.destroy();
  }

  protected select(symbol: string): void {
    this.selectedSymbol.set(symbol);
    this.outcome.set(null);
  }

  protected selectSide(side: OrderSide): void {
    this.side.set(side);
    this.outcome.set(null);
  }

  protected selectRange(range: ChartRange): void {
    this.range.set(range);
  }

  protected sellAll(): void {
    const units = this.unitsAvailable();
    if (units > 0) {
      this.form.controls.quantity.setValue(String(units));
      this.form.controls.quantity.markAsTouched();
    }
  }

  protected quantityMessage(): string | null {
    const control = this.form.controls.quantity;
    if (!control.touched || !control.errors) {
      return null;
    }
    return FIELD_MESSAGES[Object.keys(control.errors)[0]] ?? 'This value is not valid.';
  }

  protected quantityInvalid(): boolean {
    const control = this.form.controls.quantity;
    return (control.touched && control.invalid) || (this.quantity() !== null && this.blocker() !== null);
  }

  protected changeTone(quote: MarketQuote): 'up' | 'down' | 'flat' {
    const change = quote.change ?? 0;
    return change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  }

  protected canSubmit(): boolean {
    return !this.submitting() && this.blocker() === null;
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.outcome.set(null);
    this.form.markAllAsTouched();

    const accountId = this.accountId();
    const symbol = this.selectedSymbol();
    const limit = this.protectedLimit();

    // The account is not a form control, so it is checked here rather than by form validity.
    if (accountId === null) {
      this.outcome.set({ kind: 'refused', message: FIELD_MESSAGES['noAccount'] });
      return;
    }
    if (symbol === null || limit === null) {
      this.outcome.set({ kind: 'refused', message: FIELD_MESSAGES['noPrice'] });
      return;
    }
    if (this.form.invalid || this.blocker() !== null || this.submitting()) {
      return;
    }

    const quantity = Number(this.form.controls.quantity.value);
    const side = this.side();
    const approx = this.currentPrice();
    this.submitting.set(true);

    this.orders
      .placeOrder({
        placeOrderRequest: {
          accountId,
          symbol,
          side,
          quantity,
          price: limit,
          // Fresh per attempt, so a double submit is a second order rather than a replay the
          // API would answer ORD-409 to.
          idempotencyKey: crypto.randomUUID()
        }
      })
      .subscribe({
        next: (order) => {
          this.submitting.set(false);
          this.outcome.set({
            kind: 'accepted',
            order,
            summary: `${side} ${quantity} ${symbol} at the current market price${
              approx !== null ? ` (about ${formatMoney(approx)} per unit)` : ''
            }`
          });
          this.form.reset({ quantity: '' });
          // The cash, the units held and the notification list all move once the order fills.
          this.loadAccountData(accountId);
          this.notifications.refresh();
        },
        error: (failure) => {
          this.submitting.set(false);
          this.outcome.set({ kind: 'refused', message: this.errorMessages.forOrderFailure(failure) });
        }
      });
  }

  /** `NEW` is accepted and still working, not accepted and finished. */
  protected statusTone(status: OrderStatus): 'success' | 'pending' | 'failed' {
    switch (status) {
      case 'FILLED':
        return 'success';
      case 'REJECTED':
      case 'CANCELLED':
        return 'failed';
      default:
        return 'pending';
    }
  }

  private startQuotePolling(): void {
    this.quotesState.set('loading');
    this.quotesSubscription = timer(0, QUOTE_REFRESH_MS)
      .pipe(switchMap(() => this.marketApi.getQuotes().pipe(catchError(() => of(null)))))
      .subscribe((quotes) => {
        if (quotes === null) {
          // Keep the last good list on screen; only a page that never loaded is a failure.
          if (this.quotesState() !== 'ready') {
            this.quotesState.set('failed');
          }
          return;
        }
        this.quotes.set(quotes);
        this.quotesState.set('ready');

        const current = this.selectedSymbol();
        if (current === null || !quotes.some((quote) => quote.symbol === current)) {
          const wanted = quotes.find((quote) => quote.symbol === this.preferredSymbol);
          this.selectedSymbol.set((wanted ?? quotes.find((quote) => quote.price !== null) ?? quotes[0])?.symbol ?? null);
        } else {
          // A fresh quote means a fresh point on the chart.
          this.loadHistory(current, this.range().points);
        }
      });
  }

  private loadHistory(symbol: string | null, points: number): void {
    this.historyRequest?.unsubscribe();
    if (symbol === null) {
      this.history.set([]);
      this.historyState.set('idle');
      return;
    }
    if (this.historyState() !== 'ready') {
      this.historyState.set('loading');
    }
    this.historyRequest = this.marketApi.getHistory(symbol, points).subscribe({
      next: (history) => {
        this.history.set(history);
        this.historyState.set('ready');
      },
      error: () => {
        this.history.set([]);
        this.historyState.set('failed');
      }
    });
  }

  /** Balance, linked bank and what is held, all keyed on the account. */
  private loadAccountData(accountId: number | null): void {
    if (accountId === null) {
      this.balance.set(null);
      this.balanceState.set('idle');
      this.account.set(null);
      this.accountState.set('idle');
      this.portfolio.set(null);
      return;
    }

    this.balanceState.set(this.balance() === null ? 'loading' : 'ready');
    this.accountState.set(this.account() === null ? 'loading' : 'ready');

    forkJoin({
      balance: this.accounts.getBalance({ id: accountId }).pipe(catchError(() => of(null))),
      account: this.accounts.getAccount({ id: accountId }).pipe(catchError(() => of(null))),
      portfolio: this.portfolioApi.getPortfolio(accountId).pipe(catchError(() => of(null)))
    }).subscribe(({ balance, account, portfolio }) => {
      // A balance that will not load is a real answer, not a blank card: the trader needs to
      // know the number they are trading against is unknown.
      this.balance.set(balance);
      this.balanceState.set(balance === null ? 'failed' : 'ready');
      this.account.set(account);
      this.accountState.set(account === null ? 'failed' : 'ready');
      this.portfolio.set(portfolio);
    });
  }

  private syncChart(): void {
    this.chart?.updateOptions(this.chartOptions(), false, false);
  }

  private chartOptions(): ApexOptions {
    const palette = chartPalette(this.theme.isDark());
    const points = this.history();
    // Coloured by the day's move, the same signal the ticker list uses, so the two never disagree.
    const change = this.selected()?.change ?? null;
    const first = points[0]?.price;
    const last = points[points.length - 1]?.price;
    const down = change !== null ? change < 0 : first !== undefined && last !== undefined && last < first;
    const color = down ? palette.down : palette.up;

    return {
      series: [{ name: 'Price', data: points.map((point) => [new Date(point.at).getTime(), point.price]) }],
      chart: {
        type: 'area',
        height: 280,
        toolbar: { show: false },
        zoom: { enabled: false },
        fontFamily: FONT,
        foreColor: palette.fore,
        background: 'transparent',
        animations: { enabled: false }
      },
      colors: [color],
      stroke: { curve: 'smooth', width: 2 },
      fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.25, opacityTo: 0.02, stops: [0, 100] } },
      dataLabels: { enabled: false },
      grid: { borderColor: palette.grid, strokeDashArray: 4 },
      xaxis: {
        type: 'datetime',
        labels: { datetimeUTC: false, style: { colors: palette.fore, fontSize: '11px' } },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: {
        labels: { formatter: (value: number) => formatMoney(value), style: { colors: palette.fore, fontSize: '11px' } }
      },
      noData: { text: 'No price history yet', style: { color: palette.fore } },
      tooltip: { theme: palette.tooltip, x: { format: 'dd MMM, HH:mm' }, y: { formatter: (value: number) => formatMoney(value) } }
    };
  }
}
