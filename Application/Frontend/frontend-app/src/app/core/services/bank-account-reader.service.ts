import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../generated/trade-client';

export interface LinkedBankAccount {
  claimed: boolean;
  clientId: number;
  accountNumber: string;
  balance: number;
  bankName: string;
  ifscCode: string;
}

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
