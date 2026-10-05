import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../generated/trade-client';

/**
 * The bank account linked to a trading account, as the Trade API returns it.
 *
 * `balance` is the money sitting in the *bank* account, which is a different
 * number from the wallet balance on `/api/v1/accounts/{id}/balance`: one is what
 * the trader has paid in, the other is what they can spend. They move together
 * only in the direction a transfer says they do.
 *
 * The names here are the ones on the wire, which is the whole point of writing
 * this out by hand. This route returns the `BankAccount` entity directly, so the
 * JSON keys come from its getters - `getBalance()` gives `balance`, not
 * `accountBalance`, and `isClaimed()` contributes a `claimed` boolean. The v1
 * contract calls the same money `bankBalance` on `TransferResponse`. One balance,
 * three names, two of them belonging to a model that is not in this contract.
 */
export interface LinkedBankAccount {
  claimed: boolean;
  clientId: number;
  accountNumber: string;
  balance: number;
  bankName: string;
  ifscCode: string;
}

/**
 * Reads the bank account behind a trading account.
 *
 * This exists because there is no generated client for the read, and not because
 * a wrapper was wanted. The v1 contract in `trade-api.yaml` has no endpoint that
 * returns a bank account: the only two places a bank balance appears anywhere in
 * the contract are the *response* to a transfer, and the onboarding response
 * written at the moment of claiming - neither of which can tell a trader what is
 * in their bank account before they move money, which is the number a page
 * called "Bank Account Details" is expected to show.
 *
 * So this calls the pre-v1 route `GET /api/bank-accounts/client/{clientId}`,
 * which already exists, already returns `accountBalance`, is already owner-or-
 * admin guarded, and already sits behind the same JWT filter as the v1 routes.
 * `bankName`, `accountNumber` and `ifscCode` come from the same call for the same
 * reason: one request answers the whole card.
 *
 * Hand-rolled rather than generated, and deliberately not added to the contract
 * from the UI side. If this route is ever folded into v1, this file should be
 * deleted in favour of the generated service rather than kept alongside it.
 */
@Injectable({ providedIn: 'root' })
export class BankAccountReaderService {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);

  getLinkedBankAccount(accountId: number): Observable<LinkedBankAccount> {
    return this.http.get<LinkedBankAccount>(
      `${this.tradeConfig.basePath}/api/bank-accounts/client/${accountId}`
    );
  }
}
