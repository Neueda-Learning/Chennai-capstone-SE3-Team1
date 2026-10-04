import { CurrencyPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AuthService } from '../../generated/auth-client';
import {
  AccountResponse,
  AccountsService,
  BalanceResponse,
  Configuration,
  FundingService,
  LinkedBankAccountResponse,
  OnboardingService,
  TransferDirection,
  TransferResponse
} from '../../generated/trade-client';
import { SessionStore } from '../../core/auth/session.store';
import { BankAccountReaderService, LinkedBankAccount } from '../../core/services/bank-account-reader.service';

/** How much of the page we know about the trader's bank. */
type BankState = 'checking' | 'unlinked' | 'linked' | 'failed';

type SubmitState = 'idle' | 'submitting' | 'done' | 'failed';

/**
 * Messages for the rules the forms block on their own, keyed by the Angular
 * validator that rejected the value. Deliberately the same shape as the order
 * ticket's: a trader should not have to read a validator name to fix a field.
 *
 * Two maps rather than one, because `Validators.pattern` reports the same key for
 * both fields while the two rules mean completely different things - "that is not
 * a bank account number" and "that is not an amount" would otherwise be answered
 * with whichever message happened to be defined last.
 */
const LINK_MESSAGES: Record<string, string> = {
  required: 'This field is required.',
  pattern: 'Use 6 to 34 letters and digits only, for example IN45HDFC0000001234567.'
};

const AMOUNT_MESSAGES: Record<string, string> = {
  required: 'This field is required.',
  min: 'Enter an amount of at least 0.01.',
  pattern: 'Amount allows at most two decimal places, for example 250 or 250.75.'
};

/**
 * The account number is the only field onboarding takes. The bank name, IFSC and
 * opening balance are looked up from the unclaimed row rather than typed in,
 * which is the point: a trader cannot invent a bank account, they can only claim
 * one that already exists. Asking for the bank name here would be a field the API
 * ignores.
 */
const ACCOUNT_NUMBER_PATTERN = /^[A-Z0-9]{6,34}$/;

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

@Component({
  selector: 'tui-bank-account-page',
  imports: [ReactiveFormsModule, CurrencyPipe],
  templateUrl: './bank-account-page.html',
  styleUrl: './bank-account-page.css'
})
export class BankAccountPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly onboarding = inject(OnboardingService);
  private readonly funding = inject(FundingService);
  private readonly accounts = inject(AccountsService);
  private readonly bankReader = inject(BankAccountReaderService);
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionStore);
  private readonly tradeConfig = inject(Configuration);

  protected readonly linkForm = this.formBuilder.nonNullable.group({
    accountNumber: ['', [Validators.required, Validators.pattern(ACCOUNT_NUMBER_PATTERN)]]
  });

  protected readonly transferForm = this.formBuilder.nonNullable.group({
    amount: ['', [Validators.required, Validators.min(0.01), Validators.pattern(MONEY_PATTERN)]]
  });

  /** Which account the token names, or null before onboarding is done. */
  protected readonly accountId = computed(() => this.session.accountId());

  /**
   * `checking` until we know, then `linked` or `unlinked`. A session with no
   * account claim is `unlinked` immediately: there is nothing to ask the API,
   * because the account it would ask about does not exist yet.
   */
  protected readonly bankState = signal<BankState>('checking');

  protected readonly linkState = signal<SubmitState>('idle');
  protected readonly linkError = signal<string | null>(null);

  /**
   * Separate from `linkError` on purpose. A session that could not be refreshed
   * is reported *after* the claim succeeded, so the page has already moved to the
   * linked view where the link form - and its error slot - no longer exists.
   * Reporting it through `linkError` would have rendered a message nobody can see.
   */
  protected readonly sessionWarning = signal<string | null>(null);

  protected readonly transferState = signal<SubmitState>('idle');
  protected readonly transferError = signal<string | null>(null);

  protected readonly lastTransfer = signal<TransferResponse | null>(null);

  /**
   * Which way the money is going. Both directions are the same endpoint and the
   * same body with a different enum value, so this is a real choice the trader
   * makes rather than a second form.
   */
  protected readonly direction = signal<TransferDirection>('BANK_TO_WALLET');

  /**
   * The two sides, kept as plain amounts because they are compared against the
   * amount being typed and there is no reason to carry a response object around
   * to read one number off it.
   */
  protected readonly walletAmount = signal<number | null>(null);
  protected readonly walletCurrency = signal<string>('USD');
  protected readonly bankAmount = signal<number | null>(null);

  /**
   * The authoritative bank row, balance included. Null until it is read, which is
   * why the card can show a bank name before it can show a bank balance: the
   * name arrives from the account read, the money needs the bank-account read.
   */
  private readonly bankAccount = signal<LinkedBankAccount | null>(null);

  /**
   * The bank row as the account read sees it, and as the claim saw it. The bank
   * account read above supersedes both once it lands, but neither of these carries
   * a balance, so they stay as the fallback for a name on a page that could not
   * read the bank account.
   */
  private readonly justLinked = signal<LinkedBankAccountResponse | null>(null);
  private readonly existing = signal<AccountResponse | null>(null);

  /**
   * The money actually available to move, which is the balance on the side the
   * money is leaving. A transfer cannot take more than this, so it is what the
   * amount is checked against: pulling 500 out of a bank account holding 300 is
   * refused whichever direction the toggle is on.
   */
  protected readonly availableToTransfer = computed<number | null>(() =>
    this.direction() === 'BANK_TO_WALLET' ? this.bankAmount() : this.walletAmount()
  );

  protected readonly availableLabel = computed<string>(() =>
    this.direction() === 'BANK_TO_WALLET' ? 'Available in bank account' : 'Available in wallet'
  );

  protected readonly destinationLabel = computed<string>(() =>
    this.direction() === 'BANK_TO_WALLET' ? 'Trading wallet' : 'Bank account'
  );

  protected readonly bankName = computed<string | null>(() => {
    const bank = this.bankAccount();
    if (bank !== null) {
      return bank.bankName;
    }
    const fresh = this.justLinked();
    if (fresh !== null) {
      return fresh.bankName;
    }
    return this.existing()?.bankName ?? null;
  });

  protected readonly bankNumber = computed<string | null>(() => {
    const fresh = this.justLinked();
    if (fresh !== null) {
      return fresh.accountNumber;
    }
    return this.existing()?.accountId ?? null;
  });

  protected readonly ifscCode = computed<string | null>(
    () => this.bankAccount()?.ifscCode ?? this.justLinked()?.ifscCode ?? null
  );

  /**
   * The transfer form only earns its place once there is a bank to pull from and
   * a numeric account key to name in the path. Before onboarding finishes, the
   * endpoint cannot be called at all - it needs `{id}` and the trader has none.
   */
  protected readonly canTransfer = computed(
    () => this.bankState() === 'linked' && this.accountId() !== null
  );

  private readonly tradeBasePath = this.tradeConfig.basePath;

  constructor() {
    // Uppercased as it is typed rather than on submit, so a trader pasting a
    // lowercase number sees it accepted immediately instead of being told the
    // format is wrong for a reason they cannot see.
    this.linkForm.controls.accountNumber.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        const upper = value.toUpperCase();
        if (upper !== value) {
          this.linkForm.controls.accountNumber.setValue(upper, { emitEvent: false });
        }
      });

    effect(() => {
      const accountId = this.session.accountId();
      if (accountId === null) {
        this.existing.set(null);
        this.bankState.set('unlinked');
        return;
      }

      // The claim response already answered this question, and answered it more
      // freshly than a re-read could. Skipping it here also avoids a second
      // round-trip that would race the refresh and briefly blank the page back to
      // its checking state.
      if (this.justLinked() !== null) {
        this.bankState.set('linked');
        return;
      }

      this.loadExisting(accountId);
    });
  }

  /**
   * Reads the account the token already names to decide whether onboarding is
   * still outstanding. A claim is necessary but not sufficient: a token can carry
   * an `accountId` for an account that never finished claiming a bank, and that is
   * exactly the case this page has to keep offering the link form for.
   */
  private loadExisting(accountId: number): void {
    const url = `${this.tradeBasePath}/api/v1/accounts/${accountId}`;

    console.info(`[bank] GET ${url}`, { accountId });

    this.bankState.set('checking');

    this.accounts.getAccount({ id: accountId }).subscribe({
      next: (account) => {
        this.existing.set(account);
        const linked = Boolean(account.bankName || account.accountId);
        this.bankState.set(linked ? 'linked' : 'unlinked');
        

        // Only a linked account has a bank row to read. Asking for one otherwise
        // would be a guaranteed 404 on every unlinked page load.
        if (linked) {
          this.loadBalances(accountId);
        }
      },
      error: (error) => {
        this.existing.set(null);
        this.bankState.set('failed');
        console.error('[bank] could not read the existing account', {
          accountId,
          status: error.status,
          statusText: error.statusText,
          error
        });
      }
    });
  }

  /**
   * Reads both sides of the money at once, in parallel and independently: they are
   * two different numbers from two different endpoints, and one of them failing
   * says nothing about the other, so neither is allowed to hold up the other.
   *
   * The wallet read is the generated client. The bank read is a hand-rolled call
   * to the pre-v1 route - see `BankAccountReaderService` for why there is no
   * generated service for it.
   */
  private loadBalances(accountId: number): void {
    console.info(`[bank] reading both balances for accountId=${accountId}`, { accountId });

    this.bankReader.getLinkedBankAccount(accountId).subscribe({
      next: (bank) => {
        this.bankAccount.set(bank);
        this.bankAmount.set(bank.balance);
       
      },
      error: (error) => {
        this.bankAmount.set(null);
        console.error('[bank] could not read the bank account', {
          accountId,
          status: error.status,
          statusText: error.statusText,
          note: 'the card will still show the bank name, just not its balance',
          error
        });
      }
    });

    this.accounts.getBalance({ id: accountId }).subscribe({
      next: (balance) => {
        this.walletAmount.set(balance.cashBalance);
        this.walletCurrency.set(balance.currency);
      },
      error: (error) => {
        this.walletAmount.set(null);
        console.error('[bank] could not read the wallet balance', {
          accountId,
          status: error.status,
          statusText: error.statusText,
          error
        });
      }
    });
  }

  /** Turns what the trader typed into the uppercase form the API pattern wants. */
  protected normaliseAccountNumber(): void {
    const control = this.linkForm.controls.accountNumber;
    control.setValue(control.value.trim().toUpperCase());
  }

  protected onLinkSubmit(event: Event): void {
    event.preventDefault();

    if (this.linkForm.invalid) {
      this.linkForm.markAllAsTouched();
      return;
    }

    const accountNumber = this.linkForm.controls.accountNumber.value.trim().toUpperCase();
    const url = `${this.tradeBasePath}/api/v1/bank-accounts`;

    this.linkState.set('submitting');
    this.linkError.set(null);

    console.info(`[bank] POST ${url}`, { accountNumber });

    this.onboarding
      .linkBankAccount({ linkBankAccountRequest: { accountNumber } })
      .subscribe({
        next: (linked) => {
          console.info('[bank] 201 linked', linked);
          this.justLinked.set(linked);
          this.linkState.set('done');
          // The claim itself succeeded, so the bank is linked and the page has to
          // say so. The refresh below is a separate concern: it decides whether
          // *transfers* work, and gating the linked view on it would hide a
          // successful one-time setup behind a token-refresh problem.
          this.bankState.set('linked');
          this.adoptRefreshedSession(linked);
          // The claim response names the bank but carries no balance, so the two
          // balances are read here too. Done on the new account's own id rather
          // than the session's, which is null at this point by definition.
          this.loadBalances(linked.accountId);
        },
        error: (error) => {
          this.linkState.set('failed');
          this.linkError.set(describeLinkError(error));
          console.error('[bank] link failed', {
            status: error.status,
            statusText: error.statusText,
            error
          });
        }
      });
  }

  /**
   * The claim creates the trading account, so the token this page is holding is
   * now stale: it predates the account and carries no `accountId` claim, which
   * every later call authorises on. The contract says to refresh, and this is
   * that. A failure here is reported rather than swallowed, because a stale token
   * would otherwise surface later as a confusing 403 on some unrelated screen.
   */
  private adoptRefreshedSession(linked: LinkedBankAccountResponse): void {
    const refreshToken = this.session.refreshToken();
    const url = `${this.auth.configuration.basePath}/auth/refresh`;

    if (refreshToken === null) {
      this.sessionWarning.set(
        'Bank account linked, but this session has no refresh token to update it. ' +
          'Sign out and sign in again to finish setting up transfers.'
      );
      return;
    }

    console.info(`[bank] POST ${url} (adopting new accountId ${linked.accountId})`);

    this.auth.refresh({ refreshRequest: { refreshToken } }).subscribe({
      next: (token) => {
        this.session.adoptTokens(token.accessToken, linked.accountId, token.refreshToken ?? refreshToken);
        console.info('[bank] session refreshed, accountId now', linked.accountId);
      },
      error: (error) => {
        this.sessionWarning.set(
          'Bank account linked, but the session could not be refreshed. ' +
            'Sign out and sign in again before transferring money.'
        );
        console.error('[bank] refresh after link failed', {
          status: error.status,
          statusText: error.statusText,
          error
        });
      }
    });
  }

  protected onTransferSubmit(event: Event): void {
    event.preventDefault();

    const accountId = this.session.accountId();
    if (accountId === null) {
      return;
    }

    if (this.transferForm.invalid) {
      this.transferForm.markAllAsTouched();
      return;
    }

    const amount = Number(this.transferForm.controls.amount.value);

    // Checked here rather than left to the API so the trader is told what is
    // actually available. The API would refuse the same transfer either way, but
    // only after a round-trip and with a message about a balance they cannot see
    // from this page.
    const available = this.availableToTransfer();
    if (available !== null && amount > available) {
      this.transferState.set('failed');
      this.transferError.set(
        `That is more than the ${this.availableLabel().toLowerCase()}. ` +
          `The most you can move right now is ${available}.`
      );
      return;
    }

    const direction = this.direction();
    const url = `${this.tradeBasePath}/api/v1/accounts/${accountId}/transfers`;

    this.transferState.set('submitting');
    this.transferError.set(null);
    this.lastTransfer.set(null);

    console.info(`[bank] POST ${url}`, { accountId, amount, direction });

    this.funding
      .transfer({
        id: accountId,
        transferRequest: {
          direction,
          amount,
          idempotencyKey: newIdempotencyKey()
        }
      })
      .subscribe({
        next: (transfer) => {
          console.info('[bank] 201 transferred', transfer);
          this.lastTransfer.set(transfer);
          this.transferState.set('done');
          this.transferForm.reset();

          // The transfer response carries both balances as they now stand, so
          // they are taken from it rather than re-read. A re-read here could
          // return the pre-transfer figures and leave the page showing a number
          // the trader has just made wrong.
          this.walletAmount.set(transfer.walletBalance);
          this.bankAmount.set(transfer.bankBalance);
          this.bankAccount.update((bank) =>
            bank === null ? bank : { ...bank, balance: transfer.bankBalance }
          );
        },
        error: (error) => {
          this.transferState.set('failed');
          this.transferError.set(describeTransferError(error));
          console.error('[bank] transfer failed', {
            status: error.status,
            statusText: error.statusText,
            error
          });
        }
      });
  }

  protected selectDirection(direction: TransferDirection): void {
    this.direction.set(direction);
    // The last amount was validated against the other side's balance, so it
    // cannot be assumed valid now that the sides have swapped.
    this.transferForm.controls.amount.markAsDirty();
    this.transferForm.controls.amount.markAsTouched();
    this.transferError.set(null);
  }

  /** The direction switch: one flick reverses the transfer, no second button. */
  protected toggleDirection(): void {
    this.selectDirection(
      this.direction() === 'BANK_TO_WALLET' ? 'WALLET_TO_BANK' : 'BANK_TO_WALLET'
    );
  }

  protected fieldInvalid(formName: 'link' | 'transfer', field: string): boolean {
    const control =
      formName === 'link'
        ? this.linkForm.controls[field as 'accountNumber']
        : this.transferForm.controls[field as 'amount'];
    return control.invalid && (control.touched || control.dirty);
  }

  protected messageFor(formName: 'link' | 'transfer', field: string): string | null {
    if (!this.fieldInvalid(formName, field)) {
      return null;
    }
    const control =
      formName === 'link'
        ? this.linkForm.controls[field as 'accountNumber']
        : this.transferForm.controls[field as 'amount'];
    const key = Object.keys(control.errors ?? {})[0];
    const messages = formName === 'link' ? LINK_MESSAGES : AMOUNT_MESSAGES;
    return key === undefined ? null : (messages[key] ?? 'This value is not valid.');
  }
}

/**
 * A UUID per transfer, as the contract recommends. A fresh key per attempt is
 * what makes a double-click safe: the second request carries a different key, so
 * the API treats it as a new transfer rather than replaying the first. Reusing one
 * key across distinct transfers would make the API drop the second as a duplicate,
 * which is the failure this avoids.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The contract folds two different situations into ACC-409, so the message has
 * to disambiguate them for the trader rather than pass the server text through.
 */
function describeLinkError(error: HttpErrorResponse): string {
  const code = error.error?.errorCode;
  if (code === 'ACC-409') {
    return 'That account number cannot be claimed. Either you already have a bank account, ' +
      'or someone else has already claimed that number.';
  }
  if (code === 'ACC-404') {
    return 'No unclaimed bank account has that number. Check the number with your bank and try again.';
  }
  if (code === 'ACC-403') {
    return 'This session is not allowed to claim that account. Sign out and sign in again.';
  }
  if (error.status === 0) {
    return 'Could not reach the Trade API. Check that it is running on port 8081.';
  }
  return error.error?.message ?? 'The bank account could not be linked.';
}

function describeTransferError(error: HttpErrorResponse): string {
  const code = error.error?.errorCode;
  if (code === 'FUND-402' || code === 'ACC-402') {
    return 'One of the two accounts cannot cover that amount.';
  }
  if (code === 'ACC-404') {
    return 'No bank account is linked to this session yet.';
  }
  if (code === 'ACC-403') {
    return 'This session cannot move money. Sign out and sign in again.';
  }
  if (error.status === 0) {
    return 'Could not reach the Trade API. Check that it is running on port 8081.';
  }
  return error.error?.message ?? 'The money could not be transferred.';
}
