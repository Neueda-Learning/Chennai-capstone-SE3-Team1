import { CurrencyPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { AccountsService, AccountResponse, BalanceResponse, Configuration } from '../../generated/trade-client';
import { OrderResponse, OrdersService } from '../../generated/trade-client';
import { OrderSide } from '../../generated/trade-client';
import { OrderStatus } from '../../generated/trade-client';
import { SessionStore } from '../../core/auth/session.store';
import { TRADABLE_INSTRUMENTS } from './instruments';
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
  imports: [ReactiveFormsModule, CurrencyPipe],
  templateUrl: './order-ticket-page.html',
  styleUrl: './order-ticket-page.css'
})
export class OrderTicketPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly orders = inject(OrdersService);
  private readonly accounts = inject(AccountsService);
  private readonly session = inject(SessionStore);
  private readonly errorMessages = inject(OrderErrorMessages);
  private readonly tradeConfig = inject(Configuration);

  protected readonly side = signal<OrderSide>('BUY');
  protected readonly orderType = signal<OrderType>('MARKET');
  protected readonly submitting = signal(false);
  protected readonly outcome = signal<OrderOutcome | null>(null);

  /** The pick list. A dropdown rather than free text, so a typo cannot become
   *  a symbol the API answers `INS-404` to. */
  protected readonly instruments = TRADABLE_INSTRUMENTS;

  /** The account's real cash balance, not a number someone typed in. */
  protected readonly balance = signal<BalanceResponse | null>(null);
  protected readonly balanceState = signal<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  /** The linked account, so the card can name it rather than print a numeric key. */
  protected readonly account = signal<AccountResponse | null>(null);
  protected readonly accountState = signal<'idle' | 'loading' | 'ready' | 'failed'>('idle');

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

  /**
   * Fetch the balance whenever the session's account is known. Keyed on
   * `accountId`, so a session whose account claim arrives later (the token is
   * decoded on sign-in, and a user without a linked bank account has none) is
   * picked up without the page reloading.
   */
  constructor() {
    effect(() => {
      const accountId = this.accountId();

      if (accountId === null) {
        const signedIn = this.session.isSignedIn();
        console.info(
          signedIn
            ? '[balance] NO REQUEST SENT — signed in, but the access token has no accountId claim. Sign in again to get a fresh token.'
            : '[balance] NO REQUEST SENT — no access token in the session at all.',
          {
            accountId,
            isSignedIn: signedIn,
            accessToken: this.session.accessToken(),
            tradeBasePath: this.tradeConfig.basePath
          }
        );
        this.balance.set(null);
        this.balanceState.set('idle');
        this.account.set(null);
        this.accountState.set('idle');
        return;
      }

      console.info('[balance] accountId claim read from the access token:', accountId, {
        accountId,
        tradeBasePath: this.tradeConfig.basePath
      });
      this.loadBalance(accountId);
      this.loadAccount(accountId);
    });
  }

  /**
   * The account's holder name, so the ticket names the account a trader is about to
   * spend from instead of showing a bare numeric key. `getAccount` is a separate call
   * from `getBalance` because it is a different question: the balance is the number
   * being risked, the name is who it belongs to.
   */
  private loadAccount(accountId: number): void {
    const url = `${this.tradeConfig.basePath}/api/v1/accounts/${accountId}`;

    console.info(`[account] GET ${url}`, {
      accountId,
      tradeBasePath: this.tradeConfig.basePath
    });

    this.accountState.set('loading');

    this.accounts.getAccount({ id: accountId }).subscribe({
      next: (account) => {
        console.info(`[account] 200 OK - ${url}`, account);
        console.info('[account] parsed fields', {
          accountId,
          accountIdInBody: account.accountId,
          holderName: account.holderName,
          bankName: account.bankName,
          bankNameType: typeof account.bankName,
          bankNameIsNull: account.bankName === null,
          bankNameIsUndefined: account.bankName === undefined,
          rawKeys: Object.keys(account as unknown as object)
        });
        console.info(
          '[account] if bankName is undefined above, the Trade API is running an older build ' +
            'that does not send the field - restart it from a freshly built jar'
        );

        this.account.set(account);
        this.accountState.set('ready');
      },
      error: (error) => {
        console.error(`[account] FAILED status=${error.status} ${error.statusText} - ${url}`, {
          accountId,
          error
        });
        this.account.set(null);
        this.accountState.set('failed');
      }
    });
  }

  private loadBalance(accountId: number): void {
    const url = `${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/balance`;

    console.info(`[balance] GET ${url}`, {
      accountId,
      tradeBasePath: this.tradeConfig.basePath,
      note: 'if this fails with status 0, the Trade API is not listening on that port'
    });

    this.balanceState.set('loading');

    this.accounts.getBalance({ id: accountId }).subscribe({
      next: (balance) => {
        console.info(`[balance] 200 OK — ${url}`, balance);
        this.balance.set(balance);
        this.balanceState.set('ready');
      },
      error: (error: HttpErrorResponse) => {
        console.error(`[balance] FAILED status=${error.status} ${error.statusText} — ${url}`, {
          accountId,
          tradeBasePath: this.tradeConfig.basePath,
          requestedUrl: url,
          status: error.status,
          statusText: error.statusText,
          message: error.message,
          responseBody: error.error
        });
        // A balance that will not load is a real answer, not a blank card: the
        // trader needs to know the number they are trading against is unknown.
        this.balance.set(null);
        this.balanceState.set('failed');
      }
    });
  }

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
