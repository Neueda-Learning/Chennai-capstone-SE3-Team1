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

type BankState = 'checking' | 'unlinked' | 'linked' | 'failed';

type SubmitState = 'idle' | 'submitting' | 'done' | 'failed';

const LINK_MESSAGES: Record<string, string> = {
  required: 'This field is required.',
  pattern: 'Use 6 to 34 letters and digits only, for example IN45HDFC0000001234567.'
};

const AMOUNT_MESSAGES: Record<string, string> = {
  required: 'This field is required.',
  min: 'Enter an amount of at least 0.01.',
  pattern: 'Amount allows at most two decimal places, for example 250 or 250.75.'
};

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

  protected readonly accountId = computed(() => this.session.accountId());

  protected readonly bankState = signal<BankState>('checking');

  protected readonly linkState = signal<SubmitState>('idle');
  protected readonly linkError = signal<string | null>(null);

  protected readonly sessionWarning = signal<string | null>(null);

  protected readonly transferState = signal<SubmitState>('idle');
  protected readonly transferError = signal<string | null>(null);

  protected readonly lastTransfer = signal<TransferResponse | null>(null);

  protected readonly direction = signal<TransferDirection>('BANK_TO_WALLET');

  protected readonly walletAmount = signal<number | null>(null);
  protected readonly walletCurrency = signal<string>('USD');
  protected readonly bankAmount = signal<number | null>(null);

  protected readonly balancesPending = signal(0);

  private readonly bankAccount = signal<LinkedBankAccount | null>(null);

  private readonly justLinked = signal<LinkedBankAccountResponse | null>(null);
  private readonly existing = signal<AccountResponse | null>(null);

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

  protected readonly canTransfer = computed(
    () => this.bankState() === 'linked' && this.accountId() !== null
  );

  private readonly tradeBasePath = this.tradeConfig.basePath;

  constructor() {
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

      if (this.justLinked() !== null) {
        this.bankState.set('linked');
        return;
      }

      this.loadExisting(accountId);
    });
  }

  private loadExisting(accountId: number): void {
    const url = `${this.tradeBasePath}/api/v1/accounts/${accountId}`;

    console.info(`[bank] GET ${url}`, { accountId });

    this.bankState.set('checking');

    this.accounts.getAccount({ id: accountId }).subscribe({
      next: (account) => {
        this.existing.set(account);
        const linked = Boolean(account.bankName || account.accountId);
        this.bankState.set(linked ? 'linked' : 'unlinked');
        

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

  private loadBalances(accountId: number): void {
    console.info(`[bank] reading both balances for accountId=${accountId}`, { accountId });

    this.balancesPending.set(2);

    this.bankReader.getLinkedBankAccount(accountId).subscribe({
      next: (bank) => {
        this.bankAccount.set(bank);
        this.bankAmount.set(bank.balance);
        this.balanceSettled();
      },
      error: (error) => {
        this.bankAmount.set(null);
        this.balanceSettled();
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
        this.balanceSettled();
      },
      error: (error) => {
        this.walletAmount.set(null);
        this.balanceSettled();
        console.error('[bank] could not read the wallet balance', {
          accountId,
          status: error.status,
          statusText: error.statusText,
          error
        });
      }
    });
  }

  private balanceSettled(): void {
    this.balancesPending.update((pending) => Math.max(0, pending - 1));
  }

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
          this.balancesPending.set(2);
          this.bankState.set('linked');
          this.adoptRefreshedSession(linked);
        },
        error: (error) => {
          this.linkState.set('failed');
          this.linkError.set(describeLinkError(error, this.tradeBasePath));
          console.error('[bank] link failed', {
            status: error.status,
            statusText: error.statusText,
            error
          });
        }
      });
  }

  private adoptRefreshedSession(linked: LinkedBankAccountResponse): void {
    const refreshToken = this.session.refreshToken();
    const url = `${this.auth.configuration.basePath}/auth/refresh`;

    if (refreshToken === null) {
      this.sessionWarning.set(
        'Bank account linked, but this session has no refresh token to update it. ' +
          'Sign out and sign in again to finish setting up transfers.'
      );
      this.loadBalances(linked.accountId);
      return;
    }

    console.info(`[bank] POST ${url} (adopting new accountId ${linked.accountId})`);

    this.auth.refresh({ refreshRequest: { refreshToken } }).subscribe({
      next: (token) => {
        this.session.adoptTokens(token.accessToken, linked.accountId, token.refreshToken ?? refreshToken);
        console.info('[bank] session refreshed, accountId now', linked.accountId);
        this.loadBalances(linked.accountId);
      },
      error: (error) => {
        this.sessionWarning.set(
          'Bank account linked, but the session could not be refreshed. ' +
            'Sign out and sign in again before transferring money.'
        );
        this.loadBalances(linked.accountId);
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

          this.walletAmount.set(transfer.walletBalance);
          this.bankAmount.set(transfer.bankBalance);
          this.bankAccount.update((bank) =>
            bank === null ? bank : { ...bank, balance: transfer.bankBalance }
          );
        },
        error: (error) => {
          this.transferState.set('failed');
          this.transferError.set(describeTransferError(error, this.tradeBasePath));
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
    this.transferForm.controls.amount.markAsDirty();
    this.transferForm.controls.amount.markAsTouched();
    this.transferError.set(null);
  }

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

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function describeLinkError(error: HttpErrorResponse, tradeApiUrl: string | undefined): string {
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
    return `Could not reach the Trade API${tradeApiUrl ? ' at ' + tradeApiUrl : ''}. Check that it is running.`;
  }
  return error.error?.message ?? 'The bank account could not be linked.';
}

function describeTransferError(error: HttpErrorResponse, tradeApiUrl: string | undefined): string {
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
    return `Could not reach the Trade API${tradeApiUrl ? ' at ' + tradeApiUrl : ''}. Check that it is running.`;
  }
  return error.error?.message ?? 'The money could not be transferred.';
}
