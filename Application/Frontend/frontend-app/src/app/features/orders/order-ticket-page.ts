import { HttpErrorResponse } from '@angular/common/http';
import { Component, HostListener, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Subscription, forkJoin, of, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { SessionStore } from '../../core/auth/session.store';
import {
  ChartInterval,
  ChartPreferences,
  ChartRange,
  ChartStyle,
  DEFAULT_PREFERENCES,
  INDICATORS,
  IndicatorId,
  INTERVALS,
  RANGES,
  defaultIntervalFor,
  intervalsFor,
  reconcileInterval
} from '../../core/charts/chart-options';
import { formatMoney, formatSignedPercent, roundToPaise } from '../../core/format/money';
import { NotificationStore } from '../../core/notifications/notification.store';
import { WatchlistStore } from '../../core/watchlists/watchlist.store';
import { AlertComposer } from '../../shared/alert-composer/alert-composer';
import { ConditionalOrderService, PendingOrder, PlacedOrder } from '../../core/services/conditional-order.service';
import { Candle, MarketQuote, MarketService } from '../../core/services/market.service';
import { sma } from '../../core/charts/indicators';
import { Portfolio, PortfolioService } from '../../core/services/portfolio.service';
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
import { OrderLevel, PriceChart } from './price-chart';
import { ScheduleMode, ScheduledOrderComposer } from './scheduled-order-composer';
import { wholeQuantity } from './order-validators';

export const PRICE_PROTECTION = 0.02;

const QUOTE_REFRESH_MS = 30_000;
const CHART_PREFS_KEY = 'trading-ui.chart';

type Load = 'idle' | 'loading' | 'ready' | 'failed';

interface OrderAccepted {
  kind: 'accepted';
  order: OrderResponse;
  summary: string;
}

interface OrderRefused {
  kind: 'refused';
  message: string;
}

type OrderOutcome = OrderAccepted | OrderRefused;

const FIELD_MESSAGES: Record<string, string> = {
  required: 'Enter how many units.',
  wholeQuantity: 'Quantity must be a whole number of units.',
  min: 'Must be greater than zero.',
  noAccount: 'No trading account is linked to this session yet.',
  noPrice: 'There is no current price for this ticker yet, so it cannot be traded.',
  notEnoughUnits: 'You cannot sell more units than you hold.',
  notEnoughCash: 'Not enough cash in your wallet for this order.'
};

@Component({
  selector: 'tui-order-ticket-page',
  imports: [ReactiveFormsModule, PriceChart, AlertComposer, ScheduledOrderComposer],
  templateUrl: './order-ticket-page.html',
  styleUrl: './order-ticket-page.css'
})
export class OrderTicketPage implements OnDestroy {
  private readonly formBuilder = inject(FormBuilder);
  private readonly orders = inject(OrdersService);
  private readonly accounts = inject(AccountsService);
  private readonly portfolioApi = inject(PortfolioService);
  private readonly marketApi = inject(MarketService);
  private readonly session = inject(SessionStore);
  private readonly errorMessages = inject(OrderErrorMessages);
  private readonly notifications = inject(NotificationStore);
  private readonly conditionalOrders = inject(ConditionalOrderService);
  protected readonly alertStore = inject(WatchlistStore);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });

  protected readonly formatMoney = formatMoney;
  protected readonly formatSignedPercent = formatSignedPercent;

  protected readonly protectionPercent = PRICE_PROTECTION * 100;
  protected readonly side = signal<OrderSide>('BUY');
  protected readonly submitting = signal(false);
  protected readonly outcome = signal<OrderOutcome | null>(null);

  protected readonly quotes = signal<MarketQuote[]>([]);
  protected readonly quotesState = signal<Load>('idle');
  protected readonly selectedSymbol = signal<string | null>(null);
  protected readonly chartOpen = signal(false);
  /** While on, a click on the chart places a price-alert marker. */
  protected readonly markerMode = signal(false);
  /** The marker being placed, drawn on the chart until it is confirmed or cancelled. */
  protected readonly pendingAlert = signal<number | null>(null);
  /** Alerts on the stock on show: drawn on the chart and counted on the Set alert button. */
  protected readonly selectedAlerts = computed(() => this.alertStore.alertsFor(this.selectedSymbol()));

  /**
   * Scheduling a conditional order from the chart (ADR 0016). The button pressed decides what it waits for: a price
   * level marked on the chart, or the moving-average line. Null while the chart is showing alerts.
   */
  protected readonly scheduleMode = signal<ScheduleMode | null>(null);
  protected readonly pendingLevel = signal<number | null>(null);
  protected readonly averageWindow = signal(20);
  protected readonly fastWindow = signal<number | null>(null);
  /** Every conditional order waiting on the account, listed under the ticket with a cancel button. */
  protected readonly scheduled = signal<PendingOrder[]>([]);
  protected readonly scheduledState = signal<Load>('idle');
  protected readonly scheduledForSelected = computed(() =>
    this.scheduled().filter((order) => order.symbol === this.selectedSymbol())
  );
  /** The waiting price-level orders on the stock on show, drawn on its chart. */
  protected readonly orderLevels = computed<OrderLevel[]>(() =>
    this.scheduledForSelected()
      .filter((order) => order.triggerPrice !== null)
      .map((order) => ({
        price: order.triggerPrice as number,
        side: order.side,
        label: `${order.side} ${order.quantity} ${order.conditionType === 'PRICE_AT_OR_ABOVE' ? '\u2265' : '\u2264'} ${formatMoney(order.triggerPrice)}`
      }))
  );
  /** The average lines the chart draws while scheduling on the moving average. */
  protected readonly averageLines = computed(() => {
    if (this.scheduleMode() !== 'AVERAGE') {
      return [];
    }
    const fast = this.fastWindow();
    return fast === null ? [this.averageWindow()] : [this.averageWindow(), fast];
  });
  protected readonly averageNow = computed(() => lastOf(sma(this.candles().map((c) => c.close), this.averageWindow())));
  protected readonly fastNow = computed(() => {
    const fast = this.fastWindow();
    return fast === null ? null : lastOf(sma(this.candles().map((c) => c.close), fast));
  });
  protected readonly armedAlertCount = computed(() => this.selectedAlerts().filter((a) => a.state === 'ARMED').length);

  protected readonly ranges = RANGES;
  protected readonly indicatorOptions = INDICATORS;
  private readonly savedPrefs = loadPreferences();
  protected readonly range = signal<ChartRange>(RANGES.find((r) => r.value === this.savedPrefs.range) ?? RANGES[3]);
  protected readonly interval = signal<ChartInterval>(
    reconcileInterval(this.range(), INTERVALS.find((i) => i.value === this.savedPrefs.interval) ?? null)
  );
  protected readonly chartStyle = signal<ChartStyle>(this.savedPrefs.style);
  protected readonly indicators = signal<readonly IndicatorId[]>(this.savedPrefs.indicators);
  protected readonly intervals = computed(() => intervalsFor(this.range()));
  protected readonly candles = signal<Candle[]>([]);
  protected readonly candlesState = signal<Load>('idle');
  protected readonly hasVolume = computed(() => this.interval().kind === 'daily');

  protected readonly balance = signal<BalanceResponse | null>(null);
  protected readonly balanceState = signal<Load>('idle');
  protected readonly account = signal<AccountResponse | null>(null);
  protected readonly accountState = signal<Load>('idle');
  private readonly portfolio = signal<Portfolio | null>(null);

  protected readonly accountId = this.session.accountId;
  protected readonly hasAccount = computed(() => this.accountId() !== null);

  protected readonly form = this.formBuilder.nonNullable.group({
    quantity: this.formBuilder.nonNullable.control('', [wholeQuantity])
  });
  private readonly quantityText = signal('');

  protected readonly selected = computed(
    () => this.quotes().find((quote) => quote.symbol === this.selectedSymbol()) ?? null
  );

  protected readonly currentPrice = computed(() => this.selected()?.price ?? null);

  protected readonly unitsAvailable = computed(() => {
    const symbol = this.selectedSymbol();
    return this.portfolio()?.holdings.find((holding) => holding.symbol === symbol)?.quantity ?? 0;
  });

  protected readonly quantity = computed(() => {
    const text = this.quantityText().trim();
    return /^\d+$/.test(text) ? Number(text) : null;
  });

  private readonly referencePrice = computed(() => {
    const quote = this.selected();
    if (quote === null || quote.price === null) {
      return null;
    }
    return (this.side() === 'BUY' ? quote.ask : quote.bid) ?? quote.price;
  });

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

  private readonly maxBuyCost = computed(() => {
    const quantity = this.quantity();
    const limit = this.protectedLimit();
    return quantity !== null && quantity > 0 && limit !== null ? roundToPaise(quantity * limit) : null;
  });

  protected readonly blocker = computed<string | null>(() => {
    if (!this.hasAccount()) {
      return FIELD_MESSAGES['noAccount'];
    }
    if (this.currentPrice() === null) {
      return FIELD_MESSAGES['noPrice'];
    }
    const quantity = this.quantity();
    if (quantity === null || quantity <= 0) {
      return null;
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

  private quotesSubscription: Subscription | null = null;
  private preferredSymbol: string | null = this.route?.snapshot?.queryParamMap?.get('symbol') ?? null;
  /** ?schedule=level|average (from the Advice page): open the chart ready to schedule, once the stock is on show. */
  private preferredSchedule: ScheduleMode | null = scheduleFrom(this.route?.snapshot?.queryParamMap?.get('schedule') ?? null);
  private candleRequest: Subscription | null = null;

  constructor() {
    this.alertStore.start();
    this.route?.queryParamMap?.pipe(takeUntilDestroyed()).subscribe((params) => {
      const wanted = params.get('symbol');
      if (wanted === null) {
        return;
      }
      this.preferredSymbol = wanted;
      this.preferredSchedule = scheduleFrom(params.get('schedule')) ?? this.preferredSchedule;
      this.applyPrefill(params.get('side'), params.get('quantity'));
      if (this.quotes().some((quote) => quote.symbol === wanted)) {
        this.select(wanted);
        this.bringTicketIntoView();
        this.openPreferredSchedule();
      }
    });

    this.form.controls.quantity.valueChanges.subscribe((value) => this.quantityText.set(String(value ?? '')));

    this.startQuotePolling();

    effect(() => {
      const accountId = this.accountId();
      untracked(() => this.loadAccountData(accountId));
    });

    effect(() => {
      const changes = this.notifications.changes();
      untracked(() => {
        if (changes > 0) {
          this.loadAccountData(this.accountId());
        }
      });
    });

    effect(() => {
      const symbol = this.selectedSymbol();
      const range = this.range();
      const interval = this.interval();
      untracked(() => this.loadCandles(symbol, interval, range));
    });

    effect(() => {
      const prefs: ChartPreferences = {
        range: this.range().value,
        interval: this.interval().value,
        style: this.chartStyle(),
        indicators: [...this.indicators()]
      };
      untracked(() => savePreferences(prefs));
    });
  }

  ngOnDestroy(): void {
    this.alertStore.stop();
    this.quotesSubscription?.unsubscribe();
    this.candleRequest?.unsubscribe();
  }

  /**
   * A link from the assistant can arrive with ?side=SELL&quantity=20. Both only fill the form in: the
   * customer still reviews it and presses Buy or Sell. Anything that is not a plain side or a whole
   * number is ignored, and the two are removed from the address so choosing another stock later does
   * not put them back.
   */
  private applyPrefill(side: string | null, quantity: string | null): void {
    const validSide = side === 'BUY' || side === 'SELL';
    const validQuantity = quantity !== null && /^[1-9]\d{0,5}$/.test(quantity);
    if (validSide) {
      this.side.set(side);
    }
    if (validQuantity) {
      this.form.controls.quantity.setValue(quantity);
      this.form.controls.quantity.markAsTouched();
    }
    if ((side !== null || quantity !== null) && this.router !== null) {
      void this.router.navigate([], {
        queryParams: { side: null, quantity: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  protected select(symbol: string): void {
    if (symbol !== this.selectedSymbol()) {
      this.pendingAlert.set(null);
    }
    this.selectedSymbol.set(symbol);
    this.outcome.set(null);
    this.syncUrl(symbol);
  }

  private syncUrl(symbol: string): void {
    if (this.router === null || this.route === null || this.route.snapshot?.queryParamMap?.get('symbol') === symbol) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { symbol },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  private bringTicketIntoView(): void {
    if (typeof window === 'undefined' || window.innerWidth >= 992) {
      return;
    }
    setTimeout(() => document.querySelector('[data-testid="selected-symbol"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  protected openChart(): void {
    if (this.selected() !== null) {
      this.chartOpen.set(true);
    }
  }

  protected closeChart(): void {
    this.chartOpen.set(false);
    this.markerMode.set(false);
    this.pendingAlert.set(null);
    this.scheduleMode.set(null);
    this.pendingLevel.set(null);
  }

  /**
   * Opens this stock's chart ready to schedule an order. On the moving average the chart shows one-minute candles
   * over the day, because the condition is checked on the live quotes, which arrive about once a minute.
   */
  protected openSchedule(mode: ScheduleMode): void {
    if (this.selected() === null) {
      return;
    }
    this.markerMode.set(false);
    this.pendingAlert.set(null);
    this.pendingLevel.set(null);
    this.scheduleMode.set(mode);
    if (mode === 'AVERAGE') {
      const day = RANGES.find((r) => r.value === '1d');
      const minute = INTERVALS.find((i) => i.value === '1m');
      if (day !== undefined && minute !== undefined) {
        this.range.set(day);
        this.interval.set(minute);
      }
    }
    this.chartOpen.set(true);
  }

  protected stopScheduling(): void {
    this.scheduleMode.set(null);
    this.pendingLevel.set(null);
  }

  /** A click on the chart: a scheduled order's level while scheduling at a level, otherwise an alert marker. */
  protected onChartMarker(price: number): void {
    if (this.scheduleMode() === 'LEVEL') {
      this.pendingLevel.set(price);
    } else {
      this.placeMarker(price);
    }
  }

  protected onScheduled(order: PlacedOrder): void {
    console.info(`[order] 201 ${order.side} PENDING [${order.symbol}, ${order.quantity}]`);
    this.loadScheduled(this.accountId());
  }

  protected cancelScheduled(order: PendingOrder): void {
    this.conditionalOrders.cancel(order.orderId).subscribe({
      next: () => this.scheduled.update((list) => list.filter((o) => o.orderId !== order.orderId)),
      error: () => this.loadScheduled(this.accountId())
    });
  }

  private openPreferredSchedule(): void {
    const mode = this.preferredSchedule;
    if (mode === null || this.selected() === null) {
      return;
    }
    this.preferredSchedule = null;
    this.openSchedule(mode);
    if (this.router !== null) {
      void this.router.navigate([], { queryParams: { schedule: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  private loadScheduled(accountId: number | null): void {
    if (accountId === null) {
      this.scheduled.set([]);
      this.scheduledState.set('idle');
      return;
    }
    this.conditionalOrders.pending(accountId).subscribe({
      next: (list) => {
        this.scheduled.set(list);
        this.scheduledState.set('ready');
      },
      error: () => this.scheduledState.set(this.scheduled().length > 0 ? 'ready' : 'failed')
    });
  }

  /** The bell beside Trend: the chart, ready to have an alert placed on it. */
  protected openAlertChart(): void {
    if (this.selected() !== null) {
      this.chartOpen.set(true);
      this.markerMode.set(true);
    }
  }

  protected placeMarker(price: number): void {
    this.pendingAlert.set(price);
  }

  protected selectAndChart(symbol: string): void {
    this.select(symbol);
    this.openChart();
  }

  @HostListener('window:keydown', ['$event'])
  protected onWindowKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.chartOpen()) {
      this.closeChart();
    }
  }

  protected selectSide(side: OrderSide): void {
    this.side.set(side);
    this.outcome.set(null);
  }

  protected selectRange(range: ChartRange): void {
    this.range.set(range);
    this.interval.set(reconcileInterval(range, this.interval()));
  }

  protected selectInterval(interval: ChartInterval): void {
    this.interval.set(interval);
  }

  protected selectStyle(style: ChartStyle): void {
    this.chartStyle.set(style);
  }

  protected toggleIndicator(id: IndicatorId): void {
    this.indicators.update((on) => (on.includes(id) ? on.filter((x) => x !== id) : [...on, id]));
  }

  protected resetChart(): void {
    const range = RANGES.find((r) => r.value === DEFAULT_PREFERENCES.range) ?? RANGES[3];
    this.range.set(range);
    this.interval.set(defaultIntervalFor(range));
    this.chartStyle.set(DEFAULT_PREFERENCES.style);
    this.indicators.set(DEFAULT_PREFERENCES.indicators);
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
      .placeOrder(
        {
          placeOrderRequest: {
            accountId,
            symbol,
            side,
            quantity,
            price: limit,
            idempotencyKey: crypto.randomUUID()
          }
        },
        'response'
      )
      .subscribe({
        next: (response) => {
          this.submitting.set(false);
          const order = response.body;
          if (order === null) {
            const message = 'The order could not be placed. Please try again.';
            console.warn(`[order] ${response.status} ${message}`);
            this.outcome.set({ kind: 'refused', message });
            return;
          }
          console.info(`[order] ${response.status} ${side === 'BUY' ? 'BOUGHT' : 'SOLD'} [${symbol}, ${quantity}]`);
          this.outcome.set({
            kind: 'accepted',
            order,
            summary: `${side} ${quantity} ${symbol} at the current market price${
              approx !== null ? ` (about ${formatMoney(approx)} per unit)` : ''
            }`
          });
          this.form.reset({ quantity: '' });
          this.loadAccountData(accountId);
          this.notifications.refresh();
        },
        error: (failure) => {
          this.submitting.set(false);
          const message = this.errorMessages.forOrderFailure(failure);
          const status = failure instanceof HttpErrorResponse ? failure.status : 'unknown';
          console.warn(`[order] ${status} ${message}`);
          this.outcome.set({ kind: 'refused', message });
        }
      });
  }

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
          this.openPreferredSchedule();
        } else {
          this.loadCandles(current, this.interval(), this.range());
        }
      });
  }

  private loadCandles(symbol: string | null, interval: ChartInterval, range: ChartRange): void {
    this.candleRequest?.unsubscribe();
    if (symbol === null) {
      this.candles.set([]);
      this.candlesState.set('idle');
      return;
    }
    if (this.candlesState() !== 'ready') {
      this.candlesState.set('loading');
    }
    this.candleRequest = this.marketApi.getCandles(symbol, interval.value, range.value).subscribe({
      next: (candles) => {
        this.candles.set(candles);
        this.candlesState.set('ready');
      },
      error: () => {
        this.candles.set([]);
        this.candlesState.set('failed');
      }
    });
  }

  private loadAccountData(accountId: number | null): void {
    this.loadScheduled(accountId);
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
      this.balance.set(balance);
      this.balanceState.set(balance === null ? 'failed' : 'ready');
      this.account.set(account);
      this.accountState.set(account === null ? 'failed' : 'ready');
      this.portfolio.set(portfolio);
    });
  }
}

function loadPreferences(): ChartPreferences {
  try {
    const raw = localStorage.getItem(CHART_PREFS_KEY);
    const parsed = raw === null ? null : (JSON.parse(raw) as Partial<ChartPreferences>);
    const known = new Set<string>(INDICATORS.map((i) => i.id));
    return {
      range: typeof parsed?.range === 'string' ? parsed.range : DEFAULT_PREFERENCES.range,
      interval: typeof parsed?.interval === 'string' ? parsed.interval : DEFAULT_PREFERENCES.interval,
      style: parsed?.style === 'line' ? 'line' : 'candles',
      indicators: Array.isArray(parsed?.indicators)
        ? (parsed.indicators.filter((id) => known.has(id)) as IndicatorId[])
        : DEFAULT_PREFERENCES.indicators
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferences(prefs: ChartPreferences): void {
  try {
    localStorage.setItem(CHART_PREFS_KEY, JSON.stringify(prefs));
  } catch {
  }
}

function scheduleFrom(value: string | null): ScheduleMode | null {
  return value === 'level' ? 'LEVEL' : value === 'average' ? 'AVERAGE' : null;
}

function lastOf(series: readonly (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const value = series[i];
    if (value !== null && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}
