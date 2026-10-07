import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../generated/trade-client';

export type Suggestion = 'BUY' | 'SELL' | 'HOLD';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type SignalSource = 'HOLDING' | 'WATCHLIST';

export interface Indicators {
  close: number | null;
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  return20dPct: number | null;
  volatilityPct: number | null;
  maxDrawdownPct: number | null;
  trend: 'UP' | 'DOWN' | 'FLAT' | null;
}

export interface Prediction {
  forDate: string;
  asOf: string;
  lastClose: number;
  predictedClose: number;
  low68: number;
  high68: number;
  low90: number;
  high90: number;
  probUp: number;
  expectedReturnPct: number;
}

/** The ETL analysis service's view on one instrument, with this customer's position in it. */
export interface TradeSignal {
  symbol: string;
  name: string | null;
  sources: SignalSource[];
  heldQuantity: number | null;
  averageCost: number | null;
  status: 'OK' | 'INSUFFICIENT_DATA';
  suggestion: Suggestion | null;
  confidence: Confidence | null;
  score: number | null;
  summary: string;
  reasons: string[];
  indicators: Indicators | null;
  asOf: string | null;
  stale: boolean;
  prediction: Prediction | null;
}

export interface Advice {
  accountId: number;
  model: string | null;
  methodology: string;
  disclaimer: string;
  generatedAt: string | null;
  dataAsOf: string | null;
  stale: boolean;
  signals: TradeSignal[];
  ideas: { buy: TradeSignal[]; sell: TradeSignal[] };
}

@Injectable({ providedIn: 'root' })
export class AdviceService {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);

  forAccount(accountId: number): Observable<Advice> {
    return this.http.get<Advice>(this.url(accountId));
  }

  forSymbol(accountId: number, symbol: string): Observable<TradeSignal> {
    return this.http.get<TradeSignal>(`${this.url(accountId)}/${encodeURIComponent(symbol)}`);
  }

  private url(accountId: number): string {
    return `${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/advice`;
  }
}

/** The badge colour the app's tables use for a suggestion. */
export function suggestionBadge(suggestion: Suggestion | null): string {
  return suggestion === 'BUY' ? 'success' : suggestion === 'SELL' ? 'failed' : 'pending';
}
