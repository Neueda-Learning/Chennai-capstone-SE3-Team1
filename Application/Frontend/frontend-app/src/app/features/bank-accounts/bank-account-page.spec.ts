import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideApi as provideAuthApi } from '../../generated/auth-client';
import { provideApi as provideTradeApi } from '../../generated/trade-client';

import { BankAccountPage } from './bank-account-page';
import { SessionStore } from '../../core/auth/session.store';

const ACCOUNT_ID = 7;
const NEW_ACCOUNT_ID = 7;
const TRADE = 'http://trade.test';
const AUTH = 'http://auth.test';
const ACCOUNT_URL = `${TRADE}/api/v1/accounts/${ACCOUNT_ID}`;
const BALANCE_URL = `${TRADE}/api/v1/accounts/${ACCOUNT_ID}/balance`;
const BANK_ACCOUNT_URL = `${TRADE}/api/bank-accounts/client/${ACCOUNT_ID}`;
const LINK_URL = `${TRADE}/api/v1/bank-accounts`;
const TRANSFER_URL = `${TRADE}/api/v1/accounts/${ACCOUNT_ID}/transfers`;
const REFRESH_URL = `${AUTH}/auth/refresh`;

type PageFixture = ComponentFixture<BankAccountPage>;

function balanceOf(overrides: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT_ID,
    cashBalance: 125000,
    currency: 'USD',
    asOf: '2026-09-30T06:00:00Z',
    ...overrides
  };
}

/**
 * The pre-v1 bank-account read, which is the only place a bank balance comes from.
 * `balance` is the key, not `accountBalance`: the route returns the entity, and
 * `getBalance()` is what Jackson names the field after.
 */
function bankAccountOf(overrides: Record<string, unknown> = {}) {
  return {
    claimed: true,
    clientId: ACCOUNT_ID,
    accountNumber: 'IN45HDFC0000001234567',
    balance: 150000,
    bankName: 'HDFC Bank',
    ifscCode: 'HDFC0001234',
    ...overrides
  };
}

function accountOf(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    accountId: 'IN45HDFC0000001234567',
    holderName: 'Sam Jag',
    bankName: 'HDFC Bank',
    cashBalance: 125000,
    status: 'ACTIVE',
    version: 0,
    lastUpdated: '2026-09-30T06:00:00Z',
    ...overrides
  };
}

function linkedOf(overrides: Record<string, unknown> = {}) {
  return {
    accountId: NEW_ACCOUNT_ID,
    accountNumber: 'IN45HDFC0000001234567',
    bankName: 'HDFC Bank',
    ifscCode: 'HDFC0001234',
    accountState: 'ACTIVE',
    ...overrides
  };
}

function transferOf(overrides: Record<string, unknown> = {}) {
  return {
    transferId: '6f2b1c2a-6a1e-4a4f-9c0d-2f7a1b3c4d5e',
    accountId: ACCOUNT_ID,
    direction: 'BANK_TO_WALLET',
    amount: 250,
    walletBalance: 125250,
    bankBalance: 149750,
    createdAt: '2026-09-30T06:10:00Z',
    ...overrides
  };
}

function textOf(fixture: PageFixture, selector: string): string {
  return fixture.nativeElement.querySelector(selector)?.textContent?.trim() ?? '';
}

function has(fixture: PageFixture, selector: string): boolean {
  return fixture.nativeElement.querySelector(selector) !== null;
}

function submit(fixture: PageFixture, selector: string): void {
  fixture.nativeElement.querySelector(selector).dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

function fill(fixture: PageFixture, selector: string, value: string): void {
  const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

/**
 * Closes a request the test only inspected, so `afterEach`'s verify() sees it as
 * handled. Failed rather than flushed on purpose: a success body would make the
 * component act on it, and the link path in particular would then open a second
 * request for the session refresh, leaking that one instead.
 */
function closeQuietly(request: TestRequest): void {
  request.error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });
}

describe('BankAccountPage', () => {
  let http: HttpTestingController;

  /**
   * Signs in every time, including when `accountId` is null: a trader mid-onboarding
   * is signed in with a token that carries no account claim, and that is exactly the
   * state this page exists for. Skipping the sign-in for that case would leave no
   * refresh token, and the post-link refresh is the one path that needs one.
   *
   * The token is not a real JWT, which is fine: the store falls back to a null
   * account when the payload cannot be read.
   */
  function setUp(
    options: { accountId?: number | null; refreshToken?: string | null } = {}
  ): void {
    const { accountId = ACCOUNT_ID, refreshToken = null } = options;

    // Explicit reset so each test starts from an un-instantiated TestBed. The
    // `expectNone`/`expectOne` assertions below are what prove there is no
    // cross-test request leak: a surviving component from a previous test would
    // add a duplicate request and fail them, not quietly pass.
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [BankAccountPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTradeApi({ basePath: TRADE }),
        provideAuthApi({ basePath: AUTH })
      ]
    });

    TestBed.inject(SessionStore).signIn('token', accountId, refreshToken);

    http = TestBed.inject(HttpTestingController);
  }

  function flushAccount(payload: Record<string, unknown> = accountOf()): void {
    http.match(ACCOUNT_URL).forEach((match) => match.flush(payload));
  }

  function flushBalances(
    bank: Record<string, unknown> = bankAccountOf(),
    wallet: Record<string, unknown> = balanceOf()
  ): void {
    http.match(BANK_ACCOUNT_URL).forEach((match) => match.flush(bank));
    http.match(BALANCE_URL).forEach((match) => match.flush(wallet));
  }

  function flushRefresh(): void {
    http
      .match(REFRESH_URL)
      .forEach((match) =>
        match.flush({ accessToken: 'fresh-token', refreshToken: 'fresh-refresh', expiresIn: 900 })
      );
  }

  /**
   * Answers the on-load reads, then lets the page settle. A linked account now
   * asks three questions - is it linked, what is in the bank, what is in the
   * wallet - so all three are flushed here and no other test has to know.
   */
  function create(
    payload: Record<string, unknown> = accountOf(),
    bank: Record<string, unknown> = bankAccountOf()
  ): PageFixture {
    const fixture = TestBed.createComponent(BankAccountPage);
    fixture.detectChanges();
    flushAccount(payload);
    fixture.detectChanges();

    if (payload['bankName'] || payload['accountId']) {
      flushBalances(bank);
      fixture.detectChanges();
    }

    return fixture;
  }

  afterEach(() => http.verify());

  describe('onboarding is still outstanding', () => {
    it('offers the link form when the session has no account claim at all', () => {
      setUp({ accountId: null });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      expect(has(fixture, '#accountNumber')).toBe(true);
      expect(has(fixture, '#amount')).toBe(false);
    });

    it('asks for no API calls it cannot make yet', () => {
      setUp({ accountId: null });
      TestBed.createComponent(BankAccountPage).detectChanges();

      http.expectNone(ACCOUNT_URL);
      http.expectNone(LINK_URL);
    });

    it('offers the link form for an account that exists but never claimed a bank', () => {
      setUp();
      const fixture = create(accountOf({ accountId: null, bankName: undefined }));

      expect(has(fixture, '#accountNumber')).toBe(true);
      expect(textOf(fixture, '[data-testid="bank-name"]')).not.toContain('HDFC');
    });

    it('rejects a number that is not shaped like a bank account number', () => {
      setUp({ accountId: null });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      fill(fixture, '#accountNumber', 'not a number!');
      submit(fixture, 'form');

      expect(textOf(fixture, '.invalid-custom')).toContain('letters and digits');
      http.expectNone(LINK_URL);
    });

    it('refuses to submit an empty number', () => {
      setUp({ accountId: null });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      submit(fixture, 'form');

      expect(textOf(fixture, '.invalid-custom')).toContain('required');
      http.expectNone(LINK_URL);
    });

    it('accepts a lowercase number by uppercasing it as it is typed', () => {
      setUp({ accountId: null });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      fill(fixture, '#accountNumber', 'in45hdfc0000001234567');
      submit(fixture, 'form');

      const request = http.expectOne(LINK_URL);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ accountNumber: 'IN45HDFC0000001234567' });
      closeQuietly(request);
    });

    it('trims stray whitespace when the field loses focus', () => {
      setUp({ accountId: null });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      const input = fixture.nativeElement.querySelector('#accountNumber') as HTMLInputElement;
      input.value = '  IN45HDFC0000001234567  ';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
      fixture.detectChanges();

      expect((fixture.nativeElement.querySelector('#accountNumber') as HTMLInputElement).value).toBe(
        'IN45HDFC0000001234567'
      );
    });
  });

  describe('linking a bank account', () => {
    it('refreshes the session so later calls carry the new accountId', () => {
      setUp({ accountId: null, refreshToken: 'old-refresh' });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      fill(fixture, '#accountNumber', 'IN45HDFC0000001234567');
      submit(fixture, 'form');

      http.expectOne(LINK_URL).flush(linkedOf());
      fixture.detectChanges();

      const refresh = http.expectOne(REFRESH_URL);
      expect(refresh.request.body).toEqual({ refreshToken: 'old-refresh' });
      refresh.flush({ accessToken: 'fresh-token', refreshToken: 'fresh-refresh' });
      fixture.detectChanges();
      flushBalances();

      expect(TestBed.inject(SessionStore).accountId()).toBe(NEW_ACCOUNT_ID);
      expect(TestBed.inject(SessionStore).accessToken()).toBe('fresh-token');
    });

    it('reads the balances only once the refreshed token is in place, and shows them straight away', () => {
      setUp({ accountId: null, refreshToken: 'old-refresh' });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      fill(fixture, '#accountNumber', 'IN45HDFC0000001234567');
      submit(fixture, 'form');

      http.expectOne(LINK_URL).flush(linkedOf());
      fixture.detectChanges();

      // The token in hand still predates the account, so the owner-guarded reads would be
      // refused. Nothing may be asked yet, and the card says it is loading, not that it failed.
      http.expectNone(BANK_ACCOUNT_URL);
      http.expectNone(BALANCE_URL);
      expect(textOf(fixture, '[data-testid="bank-balance"]')).toContain('Loading');
      expect(textOf(fixture, '[data-testid="wallet-balance"]')).toContain('Loading');

      flushRefresh();
      fixture.detectChanges();
      flushBalances(bankAccountOf({ balance: 150000 }), balanceOf({ cashBalance: 0 }));
      fixture.detectChanges();

      expect(textOf(fixture, '[data-testid="bank-balance"]')).toContain('150,000');
      // A brand new wallet is empty: that is a balance of zero, not a failed read.
      expect(textOf(fixture, '[data-testid="wallet-balance"]')).toContain('0.00');
    });

    it('reveals the linked bank details after a successful link', () => {
      setUp({ accountId: null, refreshToken: 'old-refresh' });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      fill(fixture, '#accountNumber', 'IN45HDFC0000001234567');
      submit(fixture, 'form');

      http.expectOne(LINK_URL).flush(linkedOf({ bankName: 'ICICI Bank' }));
      fixture.detectChanges();
      flushRefresh();
      fixture.detectChanges();
      flushBalances();

      expect(textOf(fixture, '[data-testid="bank-name"]')).toBe('ICICI Bank');
      expect(textOf(fixture, '[data-testid="bank-number"]')).toBe('IN45HDFC0000001234567');
      expect(textOf(fixture, '[data-testid="bank-ifsc"]')).toBe('HDFC0001234');
    });

    it('no longer offers the link form once a bank is linked', () => {
      setUp({ accountId: null, refreshToken: 'old-refresh' });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      fill(fixture, '#accountNumber', 'IN45HDFC0000001234567');
      submit(fixture, 'form');

      http.expectOne(LINK_URL).flush(linkedOf());
      fixture.detectChanges();
      flushRefresh();
      fixture.detectChanges();
      flushBalances();

      expect(has(fixture, '#accountNumber')).toBe(false);
    });

    it('explains that the session needs a new sign-in when the refresh is not possible', () => {
      setUp({ accountId: null, refreshToken: null });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      fill(fixture, '#accountNumber', 'IN45HDFC0000001234567');
      submit(fixture, 'form');

      http.expectOne(LINK_URL).flush(linkedOf());
      fixture.detectChanges();

      // The claim worked, so the linked card is showing; the warning has to live
      // there too or the trader is never told their session needs renewing.
      expect(textOf(fixture, '[data-testid="bank-name"]')).toBe('HDFC Bank');
      expect(textOf(fixture, '[data-testid="session-warning"]')).toContain('no refresh token');
      http.expectNone(REFRESH_URL);
      // The session is no refreshable, so there is no account id to read the
      // balances with - but the claim response named one, and that is enough to
      // ask. These must not be left hanging as a silent unhandled request.
      flushBalances();
    });

    it('separates the two situations the contract folds into ACC-409', () => {
      setUp({ accountId: null });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      fill(fixture, '#accountNumber', 'IN45HDFC0000001234567');
      submit(fixture, 'form');

      http
        .expectOne(LINK_URL)
        .flush(
          { errorCode: 'ACC-409', message: 'Account already exists' },
          { status: 409, statusText: 'Conflict' }
        );
      fixture.detectChanges();

      expect(textOf(fixture, '.alert-danger')).toContain('already have a bank account');
    });

    it('tells the trader when the number matches nothing', () => {
      setUp({ accountId: null });
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      fill(fixture, '#accountNumber', 'IN45ZZZZ0000000000000');
      submit(fixture, 'form');

      http
        .expectOne(LINK_URL)
        .flush(
          { errorCode: 'ACC-404', message: 'Not found' },
          { status: 404, statusText: 'Not Found' }
        );
      fixture.detectChanges();

      expect(textOf(fixture, '.alert-danger')).toContain('No unclaimed bank account');
    });
  });

  describe('a bank account is already linked', () => {
    it('shows the bank from the account the token names, without re-linking', () => {
      setUp();
      const fixture = create(
        accountOf({ bankName: 'State Bank' }),
        bankAccountOf({ bankName: 'State Bank' })
      );

      expect(textOf(fixture, '[data-testid="bank-name"]')).toBe('State Bank');
      expect(has(fixture, '#accountNumber')).toBe(false);
    });

    it('does not call onboarding at all for an already-linked trader', () => {
      setUp();
      create();

      http.expectNone(LINK_URL);
    });

    it('surfaces a read failure rather than pretending the account is unlinked', () => {
      setUp();
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();

      http
        .expectOne(ACCOUNT_URL)
        .flush(
          { errorCode: 'ACC-403', message: 'nope' },
          { status: 403, statusText: 'Forbidden' }
        );
      fixture.detectChanges();

      expect(textOf(fixture, '.alert-danger')).toContain('Could not read your account');
      // The link form must not appear here: a failed read is not proof of "not linked",
      // and offering a one-time form on a transient error would burn the trader's only claim.
      expect(has(fixture, '#accountNumber')).toBe(false);
    });
  });

  describe('showing both balances', () => {
    it('reads the bank balance from the bank-account route the wallet cannot see', () => {
      setUp();
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();
      flushAccount();

      const bank = http.expectOne(BANK_ACCOUNT_URL);
      expect(bank.request.method).toBe('GET');
      bank.flush(bankAccountOf({ balance: 150000 }));
      fixture.detectChanges();

      // The account read carries a wallet-shaped `cashBalance` of 125000. If the
      // card were reading the bank number off the account it would show that one
      // here instead, which is the specific mistake this asserts against.
      expect(textOf(fixture, '[data-testid="bank-balance"]')).toContain('150,000');

      // The wallet read is not what this test is about, but it is fired, and an
      // unanswered request fails verify() for a reason that has nothing to do
      // with the assertion above.
      http.expectOne(BALANCE_URL).flush(balanceOf());
    });

    it('takes the bank name from the bank-account read, not the account read', () => {
      setUp();
      // The two reads disagree on purpose. The bank-account route reads the bank
      // row itself; the account read copies a name onto the trading account when
      // it was written. Where they differ, the row is the fact.
      const fixture = create(
        accountOf({ bankName: 'Stale Name' }),
        bankAccountOf({ bankName: 'HDFC Bank' })
      );

      expect(textOf(fixture, '[data-testid="bank-name"]')).toBe('HDFC Bank');
    });

    it('shows the wallet balance beside the bank balance', () => {
      setUp();
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();
      flushAccount();

      const wallet = http.expectOne(BALANCE_URL);
      expect(wallet.request.method).toBe('GET');
      wallet.flush(balanceOf({ cashBalance: 125000 }));
      fixture.detectChanges();

      flushBalances(bankAccountOf(), balanceOf());
      fixture.detectChanges();

      expect(textOf(fixture, '[data-testid="wallet-balance"]')).toContain('125,000');
    });

    it('keeps the bank name readable when the bank balance itself cannot be read', () => {
      setUp();
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();
      flushAccount(accountOf({ bankName: 'State Bank' }));

      http
        .expectOne(BANK_ACCOUNT_URL)
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
      flushBalances(bankAccountOf(), balanceOf());
      fixture.detectChanges();

      // One failed read must not blank the card: the name came from a different
      // request and is still true, so hiding it would lose a fact, not fix one.
      expect(textOf(fixture, '[data-testid="bank-name"]')).toBe('State Bank');
      expect(textOf(fixture, '[data-testid="bank-balance"]')).toContain('Could not load');
    });

    it('says so on the side that failed instead of showing a zero', () => {
      setUp();
      const fixture = TestBed.createComponent(BankAccountPage);
      fixture.detectChanges();
      flushAccount();

      http
        .expectOne(BALANCE_URL)
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
      flushBalances();
      fixture.detectChanges();

      expect(textOf(fixture, '[data-testid="wallet-balance"]')).toContain('Could not load');
      // A hard zero would read as "you have nothing", which is a different and
      // wrong claim, so the balance is left absent rather than defaulted.
      expect(textOf(fixture, '[data-testid="wallet-balance"]')).not.toContain('$0.00');
    });

    it('adopts both balances the transfer response reports', () => {
      setUp();
      const fixture = create();
      flushBalances(bankAccountOf({ balance: 150000 }), balanceOf({ cashBalance: 125000 }));
      fixture.detectChanges();

      fill(fixture, '#amount', '250');
      submit(fixture, 'form');
      http.expectOne(TRANSFER_URL).flush(transferOf());
      fixture.detectChanges();

      // No second read: the numbers on screen after a transfer have to be the
      // ones the API just returned, not a re-read that could land mid-write.
      expect(textOf(fixture, '[data-testid="wallet-balance"]')).toContain('125,250');
      expect(textOf(fixture, '[data-testid="bank-balance"]')).toContain('149,750');
      http.expectNone(BANK_ACCOUNT_URL);
    });
  });

  describe('moving money in either direction', () => {
    function linkedPage(): PageFixture {
      setUp();
      return create();
    }

    it('defaults to bank to wallet', () => {
      const fixture = linkedPage();

      fill(fixture, '#amount', '250');
      submit(fixture, 'form');

      const request = http.expectOne(TRANSFER_URL);
      expect(request.request.method).toBe('POST');
      expect(request.request.body.direction).toBe('BANK_TO_WALLET');
      expect(request.request.body.amount).toBe(250);
      expect(request.request.body.idempotencyKey).toEqual(expect.any(String));
      expect(request.request.body.idempotencyKey.length).toBeGreaterThanOrEqual(8);
      closeQuietly(request);
    });

    it('shows the switch off for bank to wallet and on once it is flicked', () => {
      const fixture = linkedPage();
      const toggle = () =>
        fixture.nativeElement.querySelector('[data-testid="direction-toggle"]') as HTMLInputElement;

      expect(toggle().checked).toBe(false);

      toggle().click();
      fixture.detectChanges();

      expect(toggle().checked).toBe(true);
      expect(textOf(fixture, '[data-testid="available"]')).toContain('Available in wallet');
    });

    it('sends wallet to bank once the direction is switched', () => {
      const fixture = linkedPage();

      (fixture.nativeElement.querySelector('[data-testid="direction-toggle"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      fill(fixture, '#amount', '250');
      submit(fixture, 'form');

      const request = http.expectOne(TRANSFER_URL);
      expect(request.request.body.direction).toBe('WALLET_TO_BANK');
      expect(request.request.body.amount).toBe(250);
      closeQuietly(request);
    });

    it('points the available figure at the side the money leaves', () => {
      const fixture = linkedPage();

      // 150000 in the bank, 125000 in the wallet, so the two are not confusable.
      expect(textOf(fixture, '[data-testid="available"]')).toContain('Available in bank account');
      expect(textOf(fixture, '[data-testid="available"]')).toContain('150,000');

      (fixture.nativeElement.querySelector('[data-testid="direction-toggle"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(textOf(fixture, '[data-testid="available"]')).toContain('Available in wallet');
      expect(textOf(fixture, '[data-testid="available"]')).toContain('125,000');
    });

    it('names the destination the money is going to', () => {
      const fixture = linkedPage();

      expect(textOf(fixture, 'label[for="amount"]')).toContain('Trading wallet');

      (fixture.nativeElement.querySelector('[data-testid="direction-toggle"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(textOf(fixture, 'label[for="amount"]')).toContain('Bank account');
    });

    it('will not pull more out of the bank than the bank holds', () => {
      const fixture = linkedPage();

      fill(fixture, '#amount', '200000');
      submit(fixture, 'form');

      // 150000 is in the bank, so 200000 is refused before it costs a round trip.
      expect(textOf(fixture, '.alert-danger')).toContain('150000');
      expect(textOf(fixture, '.alert-danger')).toContain('most you can move');
      http.expectNone(TRANSFER_URL);
    });

    it('will not move more back than the wallet holds', () => {
      const fixture = linkedPage();

      (fixture.nativeElement.querySelector('[data-testid="direction-toggle"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      fill(fixture, '#amount', '200000');
      submit(fixture, 'form');

      // The bank holds 150000 and would cover this, so it is the wallet figure
      // that has to be the thing stopping it.
      expect(textOf(fixture, '.alert-danger')).toContain('available in wallet');
      expect(textOf(fixture, '.alert-danger')).toContain('125000');
      http.expectNone(TRANSFER_URL);
    });

    it('allows an amount equal to the whole balance', () => {
      const fixture = linkedPage();

      fill(fixture, '#amount', '150000');
      submit(fixture, 'form');

      const request = http.expectOne(TRANSFER_URL);
      expect(request.request.body.amount).toBe(150000);
      closeQuietly(request);
    });

    it('re-validates an amount that was already under the other side limit', () => {
      const fixture = linkedPage();

      fill(fixture, '#amount', '140000');
      submit(fixture, 'form');
      closeQuietly(http.expectOne(TRANSFER_URL));

      // 140000 clears the bank but not the wallet, so switching direction has to
      // make the same number invalid again rather than carry the earlier verdict.
      (fixture.nativeElement.querySelector('[data-testid="direction-toggle"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      submit(fixture, 'form');

      expect(textOf(fixture, '.alert-danger')).toContain('125000');
      http.expectNone(TRANSFER_URL);
    });

    it('gives each attempt a different key, so a double click cannot pay twice', () => {
      const fixture = linkedPage();

      fill(fixture, '#amount', '100');
      submit(fixture, 'form');
      const first = http.expectOne(TRANSFER_URL);
      const firstKey = first.request.body.idempotencyKey;
      closeQuietly(first);

      fill(fixture, '#amount', '100');
      submit(fixture, 'form');
      const second = http.expectOne(TRANSFER_URL);
      const secondKey = second.request.body.idempotencyKey;
      closeQuietly(second);

      expect(firstKey).not.toBe(secondKey);
    });

    it('shows both resulting balances after a transfer', () => {
      const fixture = linkedPage();

      fill(fixture, '#amount', '250');
      submit(fixture, 'form');

      http.expectOne(TRANSFER_URL).flush(transferOf());
      fixture.detectChanges();

      const result = textOf(fixture, '[data-testid="transfer-result"]');
      expect(result).toContain('125250');
      expect(result).toContain('149750');
    });

    it('describes a wallet to bank transfer in the result, not the fixed copy', () => {
      const fixture = linkedPage();

      (fixture.nativeElement.querySelector('[data-testid="direction-toggle"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      fill(fixture, '#amount', '250');
      submit(fixture, 'form');
      http.expectOne(TRANSFER_URL).flush(
        transferOf({ direction: 'WALLET_TO_BANK', walletBalance: 124750, bankBalance: 150250 })
      );
      fixture.detectChanges();

      const result = textOf(fixture, '[data-testid="transfer-result"]');
      expect(result).toContain('from your wallet to your bank');
      expect(result).not.toContain('from your bank to your wallet');
    });

    it('clears the amount so the next transfer is not a repeat of the last one', () => {
      const fixture = linkedPage();

      fill(fixture, '#amount', '250');
      submit(fixture, 'form');
      http.expectOne(TRANSFER_URL).flush(transferOf());
      fixture.detectChanges();

      expect((fixture.nativeElement.querySelector('#amount') as HTMLInputElement).value).toBe('');
    });

    it('rejects an amount the contract would not accept', () => {
      const fixture = linkedPage();

      fill(fixture, '#amount', '0.001');
      submit(fixture, 'form');

      expect(textOf(fixture, '.invalid-custom')).not.toBe('');
      http.expectNone(TRANSFER_URL);
    });

    it('rejects an amount with more than two decimal places', () => {
      const fixture = linkedPage();

      fill(fixture, '#amount', '10.999');
      submit(fixture, 'form');

      expect(textOf(fixture, '.invalid-custom')).toContain('two decimal places');
      http.expectNone(TRANSFER_URL);
    });

    it('explains an empty amount instead of sending a zero', () => {
      const fixture = linkedPage();

      submit(fixture, 'form');

      expect(textOf(fixture, '.invalid-custom')).toContain('required');
      http.expectNone(TRANSFER_URL);
    });

    it('names the real cause when an account cannot cover it', () => {
      const fixture = linkedPage();

      fill(fixture, '#amount', '1000');
      submit(fixture, 'form');

      http
        .expectOne(TRANSFER_URL)
        .flush(
          { errorCode: 'FUND-402', message: 'Insufficient funds' },
          { status: 402, statusText: 'Payment Required' }
        );
      fixture.detectChanges();

      // The message cannot say "the bank account" any more: either side can be
      // the one that is short, and naming the wrong one would be misleading.
      expect(textOf(fixture, '.alert-danger')).toContain('One of the two accounts cannot cover');
    });

    it('reports an unreachable Trade API rather than a silent no-op', () => {
      const fixture = linkedPage();

      fill(fixture, '#amount', '250');
      submit(fixture, 'form');

      http
        .expectOne(TRANSFER_URL)
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
      fixture.detectChanges();

      expect(textOf(fixture, '.alert-danger')).toContain('Could not reach the Trade API');
    });
  });
});
