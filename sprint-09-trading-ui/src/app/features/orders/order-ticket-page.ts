import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { OrderResponse, OrdersService } from '../../generated/trade-client';
import { OrderSide } from '../../generated/trade-client';
import { OrderStatus } from '../../generated/trade-client';
import { SessionStore } from '../../core/auth/session.store';
import { OrderErrorMessages } from './order-error-messages';
import { priceValidators, tradableSymbol, wholeQuantity } from './order-validators';

type OrderType = 'MARKET' | 'LIMIT';

interface OrderAccepted {
  kind: 'accepted';
  order: OrderResponse;
}

interface OrderRefused {
  kind: 'refused';
  message: string;
}

type OrderOutcome = OrderAccepted | OrderRefused;

type TicketField = 'symbol' | 'quantity' | 'price';

/** Messages for the rules the form blocks on its own. */
const FIELD_MESSAGES: Record<string, string> = {
  required: 'This field is required.',
  wholeQuantity: 'Quantity must be a whole number of units.',
  min: 'Must be greater than zero.',
  priceFormat: 'Enter a number, for example 1450 or 1450.25.',
  decimals: 'Price allows at most two decimal places.',
  symbolFormat: 'Enter a ticker such as RELIANCE, TCS.NS, FX:USDINR or X:BTC.',
  noAccount: 'No trading account is linked to this session yet.'
};

@Component({
  selector: 'tui-order-ticket-page',
  imports: [ReactiveFormsModule],
  templateUrl: './order-ticket-page.html',
  styleUrl: './order-ticket-page.css'
})
export class OrderTicketPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly orders = inject(OrdersService);
  private readonly session = inject(SessionStore);
  private readonly errorMessages = inject(OrderErrorMessages);

  protected readonly side = signal<OrderSide>('BUY');
  protected readonly orderType = signal<OrderType>('MARKET');
  protected readonly submitting = signal(false);
  protected readonly outcome = signal<OrderOutcome | null>(null);

  /**
   * The account comes from the token, so it is shown and not offered as a
   * field. An editable account would be an authorisation decision moved into
   * the browser, and the API would refuse it anyway.
   */
  protected readonly accountId = this.session.accountId;
  protected readonly hasAccount = computed(() => this.accountId() !== null);

  /**
   * Price is validated whatever the order type says, because the contract has
   * one placement shape: `PlaceOrderRequest.price` is required and business
   * rule 5 requires it above zero, with no market variant. The MARKET/LIMIT
   * choice is ticket UI only — the API takes the same body either way.
   */
  protected readonly form = this.formBuilder.nonNullable.group({
    symbol: this.formBuilder.nonNullable.control('', [tradableSymbol]),
    quantity: this.formBuilder.nonNullable.control('', [wholeQuantity]),
    price: this.formBuilder.nonNullable.control('', priceValidators())
  });

  protected selectSide(side: OrderSide): void {
    this.side.set(side);
  }

  protected selectOrderType(orderType: OrderType): void {
    this.orderType.set(orderType);
  }

  protected messageFor(field: TicketField): string | null {
    const control = this.form.controls[field];

    if (!control.touched || !control.errors) {
      return null;
    }

    return FIELD_MESSAGES[Object.keys(control.errors)[0]] ?? 'This value is not valid.';
  }

  protected fieldInvalid(field: TicketField): boolean {
    const control = this.form.controls[field];
    return control.touched && control.invalid;
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.outcome.set(null);

    this.form.markAllAsTouched();

    const accountId = this.accountId();

    // The account is not a form control, so it is checked here rather than by
    // the form's own validity.
    if (accountId === null) {
      this.outcome.set({ kind: 'refused', message: FIELD_MESSAGES['noAccount'] });
      return;
    }

    if (this.form.invalid || this.submitting()) {
      return;
    }

    const { symbol, quantity, price } = this.form.getRawValue();

    this.submitting.set(true);

    this.orders
      .placeOrder({
        placeOrderRequest: {
          accountId,
          symbol: symbol.trim().toUpperCase(),
          side: this.side(),
          quantity: Number(quantity),
          price: Number(price),
          // Fresh per attempt, so a double submit is a second order rather
          // than a replay the API would answer ORD-409 to.
          idempotencyKey: crypto.randomUUID()
        }
      })
      .subscribe({
        next: (order) => {
          this.submitting.set(false);
          this.outcome.set({ kind: 'accepted', order });
        },
        error: (failure) => {
          this.submitting.set(false);
          this.outcome.set({
            kind: 'refused',
            message: this.errorMessages.forOrderFailure(failure)
          });
        }
      });
  }

  /** `NEW` is accepted and still working, not accepted and finished. */
  protected statusTone(status: OrderStatus): 'success' | 'pending' | 'failed' {
    switch (status) {
      case 'FILLED':
        return 'success';
      case 'REJECTED':
        return 'failed';
      case 'CANCELLED':
        return 'failed';
      default:
        return 'pending';
    }
  }
}
