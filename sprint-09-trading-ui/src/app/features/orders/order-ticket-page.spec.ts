import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FormGroup } from '@angular/forms';
import { provideApi } from '../../generated/trade-client';

import { OrderTicketPage } from './order-ticket-page';
import { SessionStore } from '../../core/auth/session.store';

const ACCOUNT_ID = 42;
const ORDERS_URL = 'http://trade.test/api/v1/orders';
const ACCOUNT_URL = `http://trade.test/api/v1/accounts/${ACCOUNT_ID}`;
const BALANCE_URL = `http://trade.test/api/v1/accounts/${ACCOUNT_ID}/balance`;

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

function balanceOf(overrides: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT_ID,
    cashBalance: 42500.5,
    currency: 'INR',
    asOf: '2026-02-14T10:15:30Z',
    ...overrides
  };
}

function accountOf(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    accountId: 'IN45HDFC0000001234567',
    holderName: 'Aarav Mehta',
    bankName: 'HDFC Bank',
    cashBalance: 42500.5,
    status: 'ACTIVE',
    version: 0,
    lastUpdated: '2026-02-14T10:15:30Z',
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

  /**
   * Builds the page. The wallet card asks for the real balance and the linked account
   * on load, so unless a test is specifically about one of those calls they are
   * flushed here — every other test should not have to know they exist.
   */
  function create(options: { settleBalance?: boolean } = {}): TicketFixture {
    const fixture = TestBed.createComponent(OrderTicketPage);
    fixture.detectChanges();

    if (options.settleBalance !== false) {
      flushBalance();
      flushAccount();
      fixture.detectChanges();
    }

    return fixture;
  }

  function flushBalance(payload: Record<string, unknown> = balanceOf()): void {
    const request = http.match(BALANCE_URL);
    if (request.length > 0) {
      request.forEach((match) => match.flush(payload));
    }
  }

  function flushAccount(payload: Record<string, unknown> = accountOf()): void {
    const request = http.match(ACCOUNT_URL);
    if (request.length > 0) {
      request.forEach((match) => match.flush(payload));
    }
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

    expect(textOf(fixture, '[data-testid="account-id"]')).toContain('Aarav Mehta');
    expect(root(fixture).querySelector('input[name="accountId"]')).toBeNull();
    expect(root(fixture).querySelector('select[name="accountId"]')).toBeNull();
  });

  it('says so when the session has no trading account', () => {
    setUp(null);
    const fixture = create();

    expect(textOf(fixture, '[data-testid="account-id"]')).toContain('Not linked');
  });

  it('offers the tradable instruments as a pick list rather than free text', () => {
    setUp();
    const fixture = create();

    const select = root(fixture).querySelector('select#symbol');
    expect(select).not.toBeNull();
    expect(root(fixture).querySelector('input#symbol')).toBeNull();

    const values = Array.from(select!.querySelectorAll('option'))
      .map((option) => option.value)
      .filter((value) => value !== '');

    expect(values).toEqual([
      'RELIANCE',
      'TCS',
      'INFY',
      'HDFCBANK',
      'ICICIBANK',
      'ITC',
      'TATAMOTORS'
    ]);
  });

  it('does not offer a retired instrument', () => {
    setUp();
    const fixture = create();

    expect(textOf(fixture, 'select#symbol')).not.toContain('LEGACYCORP');
  });

  it('shows the balance the API returned, not a constant', () => {
    setUp();
    const fixture = create({ settleBalance: false });

    const request = http.expectOne(BALANCE_URL);
    expect(request.request.method).toBe('GET');
    expect(textOf(fixture, '[data-testid="balance"]')).toContain('Loading');

    request.flush(balanceOf({ cashBalance: 1234.56, currency: 'INR' }));
    flushAccount();
    fixture.detectChanges();

    const balance = textOf(fixture, '[data-testid="balance"]');
    expect(balance).toContain('1,234.56');
    expect(balance).not.toContain('42,500');
  });

  it('formats the balance in the currency the API named', () => {
    setUp();
    const fixture = create({ settleBalance: false });

    http.expectOne(BALANCE_URL).flush(balanceOf({ cashBalance: 99.5, currency: 'USD' }));
    flushAccount();
    fixture.detectChanges();

    expect(textOf(fixture, '[data-testid="balance"]')).toContain('$99.50');
  });

  it('says the balance is unknown when it will not load', () => {
    setUp();
    const fixture = create({ settleBalance: false });

    http
      .expectOne(BALANCE_URL)
      .flush({ errorCode: 'ACC-403', message: 'nope' }, { status: 403, statusText: 'Forbidden' });
    flushAccount();
    fixture.detectChanges();

    expect(textOf(fixture, '[data-testid="balance"]')).toContain('Could not load balance');
  });

  it('does not ask for a balance the session has no account for', () => {
    setUp(null);
    create();

    http.expectNone(BALANCE_URL);
    http.expectNone(ACCOUNT_URL);
  });

  describe('the linked account', () => {
    it('leads with the bank name, not the username or the numeric key', () => {
      setUp();
      const fixture = create();

      expect(textOf(fixture, '[data-testid="bank-name"]')).toBe('HDFC Bank');
      expect(textOf(fixture, '[data-testid="account-id"]')).not.toContain(String(ACCOUNT_ID));
    });

    it('keeps the holder name and business number as context under the bank', () => {
      setUp();
      const fixture = create();

      const text = textOf(fixture, '[data-testid="account-id"]');
      expect(text).toContain('Aarav Mehta');
      expect(text).toContain('IN45HDFC0000001234567');
    });

    it('says no bank linked when the user has not linked one', () => {
      setUp();
      const fixture = TestBed.createComponent(OrderTicketPage);
      fixture.detectChanges();
      flushBalance();
      flushAccount(accountOf({ accountId: null, bankName: null }));
      fixture.detectChanges();

      const text = textOf(fixture, '[data-testid="account-id"]');
      expect(textOf(fixture, '[data-testid="bank-name"]')).toBe('No bank linked');
      expect(text).toContain('Aarav Mehta');
      expect(text).not.toContain('null');
    });

    it('says the account is not linked when the session has no account claim', () => {
      setUp(null);
      const fixture = create();

      expect(textOf(fixture, '[data-testid="account-id"]')).toContain('Not linked');
    });

    it('reports an account it could not load, rather than showing a blank', () => {
      setUp();
      const fixture = TestBed.createComponent(OrderTicketPage);
      fixture.detectChanges();
      flushBalance();
      http
        .expectOne(ACCOUNT_URL)
        .flush({ errorCode: 'ACC-403', message: 'nope' }, { status: 403, statusText: 'Forbidden' });
      fixture.detectChanges();

      expect(textOf(fixture, '[data-testid="account-id"]')).toContain('Could not load account');
    });

    it('asks for the account the token names, not one the page could choose', () => {
      setUp();
      TestBed.createComponent(OrderTicketPage).detectChanges();

      const request = http.expectOne(ACCOUNT_URL);
      expect(request.request.method).toBe('GET');
      expect(request.request.urlWithParams).toBe(ACCOUNT_URL);

      flushBalance();
    });
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
