import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';

import { inferDirection, percentFrom, roundPrice } from '../../core/charts/price-axis';
import { formatMoney, formatSignedPercent, roundToPaise } from '../../core/format/money';
import {
  ConditionSpec,
  ConditionType,
  ConditionalOrderService,
  PlacedOrder,
  newIdempotencyKey
} from '../../core/services/conditional-order.service';
import { OrderErrorMessages } from './order-error-messages';

export type ScheduleMode = 'LEVEL' | 'AVERAGE';
export type ScheduleSide = 'BUY' | 'SELL';

/** How far past the trigger (or today's price) a scheduled order's limit is set when none is typed. */
export const SCHEDULE_PROTECTION = 0.02;
export const QUICK_LEVELS = [-5, -2, 2, 5] as const;
const DEFAULT_AVERAGE = 20;
const DEFAULT_FAST = 5;

/**
 * Places a scheduled (conditional) order from the chart, beside it in the chart dialog (ADR 0016).
 *
 * The button that opened it decides what the order waits for. LEVEL: the customer marks a price on the chart (or
 * types one) and whether it waits for a rise or a fall is inferred from where the mark sits against today's price.
 * AVERAGE: the chart draws the moving-average line and the condition is the price (or a faster average) crossing
 * it. Either way the panel then asks buy or sell, and for AVERAGE the side decides the direction: a buy waits for
 * the price to cross above the line, a sell for it to cross below. Nothing is placed until Confirm.
 */
@Component({
  selector: 'tui-scheduled-order-composer',
  templateUrl: './scheduled-order-composer.html',
  styleUrls: ['../../shared/alert-composer/alert-composer.css', './scheduled-order-composer.css']
})
export class ScheduledOrderComposer {
  readonly symbol = input.required<string>();
  readonly mode = input.required<ScheduleMode>();
  readonly accountId = input<number | null>(null);
  readonly currentPrice = input<number | null>(null);
  readonly unitsHeld = input(0);
  /** The average line's latest value and the faster average's, as the chart computed them (null when unknown). */
  readonly averageNow = input<number | null>(null);
  readonly fastNow = input<number | null>(null);
  /** The level marked on the chart. Two-way: a chart click sets it, typing here moves the chart's line. */
  readonly level = model<number | null>(null);
  /** The average line's window, and an optional faster one (null: the price itself). Two-way, for the chart. */
  readonly averageWindow = model(DEFAULT_AVERAGE);
  readonly fastWindow = model<number | null>(null);
  readonly placed = output<PlacedOrder>();
  readonly closed = output<void>();

  private readonly orders = inject(ConditionalOrderService);
  private readonly errorMessages = inject(OrderErrorMessages);

  protected readonly formatMoney = formatMoney;
  protected readonly formatPercent = formatSignedPercent;
  protected readonly quickLevels = QUICK_LEVELS;
  protected readonly protectionPercent = SCHEDULE_PROTECTION * 100;

  protected readonly side = signal<ScheduleSide | null>(null);
  protected readonly levelText = signal('');
  protected readonly quantityText = signal('');
  protected readonly limitText = signal('');
  protected readonly expiryText = signal('30');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);

  /** LEVEL: a mark above today's price waits for a rise to it, below for a fall. */
  protected readonly direction = computed(() => {
    const level = this.level();
    return level === null ? null : inferDirection(level, this.currentPrice());
  });
  protected readonly distance = computed(() => {
    const level = this.level();
    return level === null ? null : percentFrom(level, this.currentPrice());
  });

  protected readonly conditionType = computed<ConditionType | null>(() => {
    if (this.mode() === 'LEVEL') {
      const direction = this.direction();
      return direction === null ? null : direction === 'ABOVE' ? 'PRICE_AT_OR_ABOVE' : 'PRICE_AT_OR_BELOW';
    }
    const side = this.side();
    return side === null ? null : side === 'BUY' ? 'MA_CROSS_ABOVE' : 'MA_CROSS_BELOW';
  });

  /** What crosses the line in AVERAGE mode: the price, or the faster average. */
  protected readonly mover = computed(() => {
    const fast = this.fastWindow();
    return fast === null ? 'the price' : `the ${fast}-quote average`;
  });

  /** Where things stand now in AVERAGE mode, so the customer sees which crossing comes next. */
  protected readonly relationNow = computed(() => {
    const line = this.averageNow();
    const mover = this.fastWindow() === null ? this.currentPrice() : this.fastNow();
    if (line === null || mover === null) {
      return null;
    }
    const where = mover > line ? 'above' : mover < line ? 'below' : 'level with';
    return `Now ${this.mover()} (${formatMoney(mover)}) is ${where} the ${this.averageWindow()}-quote average (${formatMoney(line)}).`;
  });

  protected readonly quantity = computed(() => {
    const text = this.quantityText().trim();
    return /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : null;
  });

  /** Typed, or worked out from the trigger (LEVEL) or today's price (AVERAGE), protected like a market order. */
  protected readonly limit = computed(() => {
    const typed = Number(this.limitText().trim());
    if (this.limitText().trim() !== '' && Number.isFinite(typed) && typed > 0) {
      return roundToPaise(typed);
    }
    const base = this.mode() === 'LEVEL' ? this.level() : this.currentPrice();
    const side = this.side();
    if (base === null || side === null) {
      return null;
    }
    return side === 'BUY'
      ? Math.ceil(base * (1 + SCHEDULE_PROTECTION) * 100) / 100
      : Math.max(Math.floor(base * (1 - SCHEDULE_PROTECTION) * 100) / 100, 0.01);
  });

  protected readonly total = computed(() => {
    const quantity = this.quantity();
    const limit = this.limit();
    return quantity !== null && limit !== null ? roundToPaise(quantity * limit) : null;
  });

  /** In words, what will happen: shown above Confirm. */
  protected readonly sentence = computed(() => {
    const side = this.side();
    const what = side === null ? 'Trade' : side === 'BUY' ? 'Buy' : 'Sell';
    const qty = this.quantity() ?? '';
    if (this.mode() === 'LEVEL') {
      const level = this.level();
      const direction = this.direction();
      if (level === null || direction === null) {
        return '';
      }
      return `${what} ${qty} ${this.symbol()} when the price ${direction === 'ABOVE' ? 'rises to' : 'falls to'} ${formatMoney(level)} or ${direction === 'ABOVE' ? 'higher' : 'lower'}`.replace(/\s+/g, ' ');
    }
    const way = side === 'SELL' ? 'below' : 'above';
    return `${what} ${qty} ${this.symbol()} when ${this.mover()} crosses ${way} the ${this.averageWindow()}-quote average`.replace(/\s+/g, ' ');
  });

  protected readonly problem = computed<string | null>(() => {
    if (this.mode() === 'LEVEL' && this.level() === null) {
      return 'Click the chart, or type a price, to mark the level.';
    }
    if (this.mode() === 'AVERAGE') {
      const line = this.averageWindow();
      const fast = this.fastWindow();
      if (!Number.isInteger(line) || line < 2 || line > 200) {
        return 'The average line needs 2 to 200 quotes.';
      }
      if (fast !== null && (!Number.isInteger(fast) || fast < 2 || fast >= line)) {
        return 'The faster average needs at least 2 quotes and fewer than the line.';
      }
    }
    const side = this.side();
    if (side === null) {
      return 'Choose buy or sell.';
    }
    const quantity = this.quantity();
    if (quantity === null) {
      return 'Enter how many units.';
    }
    if (side === 'SELL' && quantity > this.unitsHeld()) {
      return `You hold ${this.unitsHeld()} ${this.symbol()}, so you cannot schedule a sale of ${quantity}.`;
    }
    const limit = this.limit();
    const level = this.level();
    if (limit === null) {
      return 'Enter a limit price.';
    }
    if (this.mode() === 'LEVEL' && level !== null) {
      if (side === 'BUY' && limit < level) {
        return 'For a buy, the limit should be at or above the level, or it will be rejected when it is placed.';
      }
      if (side === 'SELL' && limit > level) {
        return 'For a sell, the limit should be at or below the level, or it will be rejected when it is placed.';
      }
    }
    const days = Number(this.expiryText());
    if (!/^\d+$/.test(this.expiryText().trim()) || days < 1 || days > 90) {
      return 'It can wait between 1 and 90 days.';
    }
    return null;
  });

  constructor() {
    // A mark from the chart fills the price box.
    effect(() => {
      const level = this.level();
      untracked(() => {
        if (level === null) {
          this.levelText.set('');
        } else if (Number(this.levelText()) !== level) {
          this.levelText.set(level.toFixed(2));
        }
      });
    });
    // Another stock, or the other kind of order, starts again.
    effect(() => {
      this.symbol();
      this.mode();
      untracked(() => this.reset());
    });
  }

  protected onLevelType(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.levelText.set(value);
    const price = Number(value);
    if (value.trim() !== '' && Number.isFinite(price) && price > 0) {
      this.level.set(roundPrice(price));
    }
    this.clearMessages();
  }

  protected quick(percent: number): void {
    const current = this.currentPrice();
    if (current !== null) {
      this.level.set(roundPrice(current * (1 + percent / 100)));
      this.clearMessages();
    }
  }

  protected setAverage(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.averageWindow.set(Number.isFinite(value) ? Math.trunc(value) : DEFAULT_AVERAGE);
    this.clearMessages();
  }

  protected toggleFast(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.fastWindow.set(on ? Math.min(DEFAULT_FAST, Math.max(this.averageWindow() - 1, 2)) : null);
    this.clearMessages();
  }

  protected setFast(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.fastWindow.set(Number.isFinite(value) ? Math.trunc(value) : DEFAULT_FAST);
    this.clearMessages();
  }

  protected chooseSide(side: ScheduleSide): void {
    this.side.set(side);
    this.clearMessages();
  }

  protected setText(field: 'quantity' | 'limit' | 'expiry', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    ({ quantity: this.quantityText, limit: this.limitText, expiry: this.expiryText })[field].set(value);
    this.clearMessages();
  }

  protected sellAll(): void {
    if (this.unitsHeld() > 0) {
      this.quantityText.set(String(this.unitsHeld()));
    }
  }

  protected confirm(): void {
    const accountId = this.accountId();
    const type = this.conditionType();
    const side = this.side();
    const quantity = this.quantity();
    const limit = this.limit();
    if (this.problem() !== null || accountId === null || type === null || side === null || quantity === null || limit === null) {
      this.error.set(this.problem() ?? 'This order cannot be scheduled yet.');
      return;
    }
    const condition: ConditionSpec =
      this.mode() === 'LEVEL'
        ? { type, triggerPrice: this.level() as number }
        : { type, shortWindow: this.fastWindow() ?? 1, longWindow: this.averageWindow() };
    const days = Number(this.expiryText());
    const summary = this.sentence();
    this.saving.set(true);
    this.error.set(null);
    this.orders
      .place({
        accountId,
        symbol: this.symbol(),
        side,
        quantity,
        price: limit,
        idempotencyKey: newIdempotencyKey('chart'),
        condition,
        expiresInDays: days
      })
      .subscribe({
        next: (order) => {
          this.saving.set(false);
          this.done.set(`${order.orderId} scheduled: ${summary}, at ${formatMoney(limit)} or better. It is checked every minute.`);
          this.placed.emit(order);
          this.side.set(null);
          this.quantityText.set('');
          this.limitText.set('');
          this.level.set(null);
        },
        error: (failure: unknown) => {
          this.saving.set(false);
          const message = this.errorMessages.forOrderFailure(failure);
          const status = failure instanceof HttpErrorResponse ? failure.status : 'unknown';
          console.warn(`[order] ${status} ${message}`);
          this.error.set(message);
        }
      });
  }

  protected close(): void {
    this.closed.emit();
  }

  private reset(): void {
    this.side.set(null);
    this.level.set(null);
    this.quantityText.set('');
    this.limitText.set('');
    this.expiryText.set('30');
    this.clearMessages();
    this.done.set(null);
  }

  private clearMessages(): void {
    this.error.set(null);
  }
}
