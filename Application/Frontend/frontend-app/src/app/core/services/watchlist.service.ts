import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../generated/trade-client';

export type AlertDirection = 'ABOVE' | 'BELOW';
export type AlertState = 'ARMED' | 'FIRED' | 'DISABLED';
export type AlertDeliveryState = 'QUEUED' | 'PENDING_CHANNEL' | 'REJECTED' | 'DELIVERY_FAILED';

export interface WatchlistEntry {
  symbol: string;
  name: string;
  price: number | null;
  currency: string | null;
  changePercent: number | null;
  stale: boolean;
  quoteAsOf: string | null;
}

export interface Watchlist {
  id: string;
  name: string;
  createdAt: string;
  instruments: WatchlistEntry[];
}

export interface PriceAlert {
  id: string;
  symbol: string;
  threshold: number;
  direction: AlertDirection;
  state: AlertState;
  deliveryState: AlertDeliveryState | null;
  firedAt: string | null;
  firedPrice: number | null;
  createdAt: string;
}

export interface NewAlert {
  symbol: string;
  threshold: number;
  direction: AlertDirection;
}

@Injectable({ providedIn: 'root' })
export class WatchlistService {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);

  list(accountId: number): Observable<Watchlist[]> {
    return this.http.get<Watchlist[]>(this.watchlists(accountId));
  }

  create(accountId: number, name: string): Observable<Watchlist> {
    return this.http.post<Watchlist>(this.watchlists(accountId), { name });
  }

  remove(accountId: number, watchlistId: string): Observable<void> {
    return this.http.delete<void>(`${this.watchlists(accountId)}/${encodeURIComponent(watchlistId)}`);
  }

  addInstrument(accountId: number, watchlistId: string, symbol: string): Observable<WatchlistEntry> {
    return this.http.post<WatchlistEntry>(
      `${this.watchlists(accountId)}/${encodeURIComponent(watchlistId)}/instruments`,
      { symbol }
    );
  }

  removeInstrument(accountId: number, watchlistId: string, symbol: string): Observable<void> {
    return this.http.delete<void>(
      `${this.watchlists(accountId)}/${encodeURIComponent(watchlistId)}/instruments/${encodeURIComponent(symbol)}`
    );
  }

  alerts(accountId: number): Observable<PriceAlert[]> {
    return this.http.get<PriceAlert[]>(this.alertsUrl(accountId));
  }

  createAlert(accountId: number, alert: NewAlert): Observable<PriceAlert> {
    return this.http.post<PriceAlert>(this.alertsUrl(accountId), alert);
  }

  setAlertState(accountId: number, alertId: string, state: 'ARMED' | 'DISABLED'): Observable<PriceAlert> {
    return this.http.patch<PriceAlert>(`${this.alertsUrl(accountId)}/${encodeURIComponent(alertId)}`, { state });
  }

  removeAlert(accountId: number, alertId: string): Observable<void> {
    return this.http.delete<void>(`${this.alertsUrl(accountId)}/${encodeURIComponent(alertId)}`);
  }

  private watchlists(accountId: number): string {
    return `${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/watchlists`;
  }

  private alertsUrl(accountId: number): string {
    return `${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/alerts`;
  }
}
