import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FormGroup } from '@angular/forms';
import { provideApi } from '../../generated/trade-client';

import { OrderTicketPage } from './order-ticket-page';
import { SessionStore } from '../../core/auth/session.store';

const ACCOUNT_ID = 42;
const ORDERS_URL = 'http://trade.test/api/v1/orders';

type TicketFixture = ComponentFixture<OrderTicketPage>;

function acceptedOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'ORD-9982',
    status: 'NEW',
    message: 'Order accepted and working.',
    symbol: 'RELIANCE',
    side: 'BUY',
    quantity: 10,
    price: 1300,
    ...overrides
  };
}

describe('OrderTicketPage', () => {
  let http: HttpTestingController;

  function setUp(accountId: number | null = ACCOUNT_ID): void {
    TestBed.configureTestingModule({
      imports: [OrderTicketPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi({ basePath: 'http://trade.test' })
      ]
    });

    if (accountId !== null) {
      TestBed.inject(SessionStore).signIn('token', accountId);
    }

    http = TestBed.inject(HttpTestingController);
  }

  function create(): TicketFixture {
    const fixture = TestBed.createComponent(OrderTicketPage);
    fixture.detectChanges();
    return fixture;
  }

  function root(fixture: TicketFixture): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function fill(fixture: TicketFixture, values: Record<string, string>): void {
    (fixture.componentInstance['form'] as FormGroup).setValue(values);
    fixture.detectChanges();
  }

  function fillValidTicket(fixture: TicketFixture): void {
    fill(fixture, { symbol: 'RELIANCE', quantity: '10', price: '1300' });
  }

  function submit(fixture: TicketFixture): void {
    (root(fixture).querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  /** Reads text out of the rendered page, failing loudly when it is absent. */
  function textOf(fixture: TicketFixture, selector: string): string {
    const found = root(fixture).querySelector(selector);
    if (found === null) {
      throw new Error(`expected ${selector} to be rendered`);
    }
    return found.textContent ?? '';
  }

  afterEach(() => {
    http?.verify();
  });

  it('should create', () => {
    setUp();
    expect(create().componentInstance).toBeTruthy();
  });

  it('should default to Buy and switch to Sell on click', () => {
    setUp();
    const fixture = create();

    const [buyBtn, sellBtn] = Array.from(
      root(fixture).querySelectorAll<HTMLButtonElement>('.btn-custom')
    );
    expect(buyBtn.classList.contains('btn-custom-primary')).toBe(true);

    sellBtn.click();
    fixture.detectChanges();

    expect(buyBtn.classList.contains('btn-custom-outline-primary')).toBe(true);
    expect(sellBtn.classList.contains('btn-custom-danger')).toBe(true);
  });

  it('renders the account the token names, and does not offer it as a field', () => {
    setUp();
    const fixture = create();

    expect(textOf(fixture, '[data-testid="account-id"]')).toContain(String(ACCOUNT_ID));
    expect(root(fixture).querySelector('input[name="accountId"]')).toBeNull();
    expect(root(fixture).querySelector('select[name="accountId"]')).toBeNull();
  });

  it('says so when the session has no trading account', () => {
    setUp(null);
    const fixture = create();

    expect(textOf(fixture, '[data-testid="account-id"]')).toContain('Not linked');
  });

  it('submits a valid order and shows the status the API returned', () => {
    setUp();
    const fixture = create();
    fillValidTicket(fixture);

    submit(fixture);

    const request = http.expectOne(ORDERS_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.accountId).toBe(ACCOUNT_ID);
    expect(request.request.body.symbol).toBe('RELIANCE');
    expect(request.request.body.quantity).toBe(10);
    expect(request.request.body.price).toBe(1300);
    expect(request.request.body.idempotencyKey).toBeTruthy();

    request.flush(acceptedOrder());
    fixture.detectChanges();

    expect(textOf(fixture, '.alert-success')).toContain('ORD-9982');
    expect(textOf(fixture, '.alert-success')).toContain('NEW');
  });

  it('shows an order that comes back FILLED as a finished one', () => {
    setUp();
    const fixture = create();
    fillValidTicket(fixture);

    submit(fixture);
    http.expectOne(ORDERS_URL).flush(acceptedOrder({ status: 'FILLED' }));
    fixture.detectChanges();

    expect(textOf(fixture, '.alert-success')).toContain('FILLED');
    expect(textOf(fixture, '.alert-success')).not.toContain('Working.');
  });

  it('blocks a fractional quantity before it reaches the wire', () => {
    setUp();
    const fixture = create();
    fill(fixture, { symbol: 'RELIANCE', quantity: '1.5', price: '1300' });

    submit(fixture);

    http.expectNone(ORDERS_URL);
    expect(textOf(fixture, '.invalid-custom')).toContain('whole number of units');
  });

  it('blocks a quantity of zero before it reaches the wire', () => {
    setUp();
    const fixture = create();
    fill(fixture, { symbol: 'RELIANCE', quantity: '0', price: '1300' });

    submit(fixture);

    http.expectNone(ORDERS_URL);
    expect(textOf(fixture, '.invalid-custom')).toContain('greater than zero');
  });

  it('blocks a price with more than two decimal places', () => {
    setUp();
    const fixture = create();
    fill(fixture, { symbol: 'RELIANCE', quantity: '10', price: '1300.125' });

    submit(fixture);

    http.expectNone(ORDERS_URL);
    expect(textOf(fixture, '.invalid-custom')).toContain('two decimal places');
  });

  it('blocks an empty quantity before it reaches the wire', () => {
    setUp();
    const fixture = create();
    fill(fixture, { symbol: 'RELIANCE', quantity: '', price: '1300' });

    submit(fixture);

    http.expectNone(ORDERS_URL);
    expect(textOf(fixture, '.invalid-custom')).toContain('required');
  });

  it('shows the mapped message for a business-rule rejection', () => {
    setUp();
    const fixture = create();
    fillValidTicket(fixture);

    submit(fixture);

    http
      .expectOne(ORDERS_URL)
      .flush(
        { errorCode: 'ORD-400', message: 'Insufficient funds in the account.' },
        { status: 400, statusText: 'Bad Request' }
      );
    fixture.detectChanges();

    expect(textOf(fixture, '.alert-danger')).toContain('Insufficient funds');
    expect(textOf(fixture, '.alert-danger')).toContain('Order not placed');
  });

  it('falls back to a readable message when the API sends no envelope', () => {
    setUp();
    const fixture = create();
    fillValidTicket(fixture);

    submit(fixture);

    http.expectOne(ORDERS_URL).flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(textOf(fixture, '.alert-danger')).toContain('could not be placed');
  });

  it('does not submit when the session has no trading account', () => {
    setUp(null);
    const fixture = create();
    fillValidTicket(fixture);

    submit(fixture);

    http.expectNone(ORDERS_URL);
    expect(textOf(fixture, '.alert-danger')).toContain('No trading account is linked');
  });
});
