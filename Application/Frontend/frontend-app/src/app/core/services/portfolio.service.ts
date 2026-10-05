import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../generated/trade-client';

export interface PortfolioEntry {
  accountId: number;
  symbol: string;
  quantity: number;
  averageCost: number;
  overallGains: number;
}

export interface Portfolio {
  accountId: number;
  holdings: PortfolioEntry[];
  positions: PortfolioEntry[];
}

@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);

  getPortfolio(accountId: number): Observable<Portfolio> {
    return this.http.get<Portfolio>(`${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/portfolio`);
  }
}
