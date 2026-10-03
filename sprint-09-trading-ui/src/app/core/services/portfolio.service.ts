import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../generated/trade-client';

/**
 * One holding or position. `overallGains` is the unrealised gain at the last polled price,
 * (price - averageCost) * quantity, refreshed once per poll cycle.
 */
export interface PortfolioEntry {
  accountId: number;
  symbol: string;
  quantity: number;
  averageCost: number;
  overallGains: number;
}

/**
 * An account's whole portfolio. `holdings` is delivery (stock owned outright, never negative);
 * `positions` is the intraday book, where a short is a negative quantity.
 */
export interface Portfolio {
  accountId: number;
  holdings: PortfolioEntry[];
  positions: PortfolioEntry[];
}

/**
 * Reads `GET /api/v1/accounts/{id}/portfolio`.
 *
 * Hand-written for the same reason as `MarketService`: the route exists on the Trade API but
 * the contract only describes `/positions`, which the API does not actually serve.
 */
@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);

  getPortfolio(accountId: number): Observable<Portfolio> {
    return this.http.get<Portfolio>(`${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/portfolio`);
  }
}
