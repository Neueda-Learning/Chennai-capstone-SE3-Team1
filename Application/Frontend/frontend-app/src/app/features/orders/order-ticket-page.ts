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
const CHART_PREFS_KEY = 'trading-ui.chart';

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
 * minute). The ticket sits beside the list, so buying never needs a scroll; the price
 * history opens as a dialog from the ticket or from any ticker row. Orders carry no
 * price field and no order type: they execute at the current market price, which is shown, and
 * a sell shows how many units of the ticker can be sold.
 */
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
  /** The trend dialog. Candles load on selection either way; this only controls the popup. */
  protected readonly chartOpen = signal(false);

  // ---- the chart: what to draw, remembered per browser
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
  /** Daily and longer candles carry volume; the intraday ones, built from polled prices, do not. */
  protected readonly hasVolume = computed(() => this.interval().kind === 'daily');

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

  private quotesSubscription: Subscription | null = null;
  private preferredSymbol: string | null = this.route?.snapshot?.queryParamMap?.get('symbol') ?? null;
  private candleRequest: Subscription | null = null;

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
        this.bringTicketIntoView();
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

    // The candles follow the selected ticker, the range and the candle size.
    effect(() => {
      const symbol = this.selectedSymbol();
      const range = this.range();
      const interval = this.interval();
      untracked(() => this.loadCandles(symbol, interval, range));
    });

    // Remember the chart setup between visits.
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

  protected select(symbol: string): void {
    this.selectedSymbol.set(symbol);
    this.outcome.set(null);
    this.syncUrl(symbol);
  }

  /**
   * Keeps ?symbol= equal to what is selected. The navbar search navigates to ?symbol=TCS, and a
   * navigation to the URL already shown does nothing: after picking another ticker by hand the
   * URL still said TCS, so searching TCS again was silently ignored.
   */
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

  /** On a narrow screen the ticket is below the ticker list, so a search result would look like nothing happened. */
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
    // Keep the candle size when it still fits the new range, else take that range's default.
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

    // Full response, not just the body: the console log for a trade carries the
    // HTTP status with it, and that only arrives on the response envelope.
    this.orders
      .placeOrder(
        {
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
          // The console carries the status and what happened, and nothing else:
          // no account, price, token or payload may be logged here.
          console.info(`[order] ${response.status} ${side === 'BUY' ? 'BOUGHT' : 'SOLD'} [${symbol}, ${quantity}]`);
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
          const message = this.errorMessages.forOrderFailure(failure);
          const status = failure instanceof HttpErrorResponse ? failure.status : 'unknown';
          console.warn(`[order] ${status} ${message}`);
          this.outcome.set({ kind: 'refused', message });
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
    // Not remembering the chart setup is harmless.
  }
}
