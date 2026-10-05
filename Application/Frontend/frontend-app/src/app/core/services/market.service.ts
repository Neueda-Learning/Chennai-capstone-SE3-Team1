import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../generated/trade-client';

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  currency: string | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  marketState: string | null;
  stale: boolean | null;
  quoteAsOf: string | null;
  receivedAt: string | null;
}

export interface MarketPoint {
  at: string;
  price: number;
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

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

  getCandles(symbol: string, interval: string, range: string): Observable<Candle[]> {
    return this.http.get<Candle[]>(
      `${this.tradeConfig.basePath}/api/v1/market/quotes/${encodeURIComponent(symbol)}/candles`,
      { params: new HttpParams().set('interval', interval).set('range', range) }
    );
  }
}
