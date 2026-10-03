import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../generated/trade-client';

/**
 * The latest polled quote for one tradable instrument.
 *
 * `price` and the fields after it are `null` for an instrument the market-data poller has not
 * priced yet; the instrument is still listed so the screen can say so rather than lose it.
 * Money fields are plain JSON numbers.
 */
export interface MarketQuote {
  symbol: string;
  name: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  currency: string | null;
  /** Price minus the previous close. */
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  marketState: string | null;
  /** The upstream marked this quote as delayed. */
  stale: boolean | null;
  quoteAsOf: string | null;
  receivedAt: string | null;
}

/** One point of a symbol's polled price history, oldest first. */
export interface MarketPoint {
  at: string;
  price: number;
}

/**
 * Reads the market data the Trade API keeps from the market-data poller.
 *
 * Hand-written rather than generated, like `BankAccountReaderService`: `/api/v1/market/**` is
 * not in `contracts/trade-api.yaml` yet. If the contract grows these routes, regenerate the
 * client and delete this file in favour of the generated service.
 */
@Injectable({ providedIn: 'root' })
export class MarketService {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);

  getQuotes(): Observable<MarketQuote[]> {
    return this.http.get<MarketQuote[]>(`${this.tradeConfig.basePath}/api/v1/market/quotes`);
  }

  getHistory(symbol: string, limit?: number): Observable<MarketPoint[]> {
    let params = new HttpParams();
    if (limit !== undefined) {
      params = params.set('limit', limit);
    }
    return this.http.get<MarketPoint[]>(
      `${this.tradeConfig.basePath}/api/v1/market/quotes/${encodeURIComponent(symbol)}/history`,
      { params }
    );
  }
}
