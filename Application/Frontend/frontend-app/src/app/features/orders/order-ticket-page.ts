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
import { Candle, MarketQuote, MarketService } from '../../core/services/market.service';
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
import { PriceChart } from './price-chart';
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
  imports: [ReactiveFormsModule, PriceChart],
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
  private candleRequest: Subscription | null = null;

  constructor() {
    this.route?.queryParamMap?.pipe(takeUntilDestroyed()).subscribe((params) => {
      const wanted = params.get('symbol');
      if (wanted === null) {
        return;
      }
      this.preferredSymbol = wanted;
      this.applyPrefill(params.get('side'), params.get('quantity'));
      if (this.quotes().some((quote) => quote.symbol === wanted)) {
        this.select(wanted);
        this.bringTicketIntoView();
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
