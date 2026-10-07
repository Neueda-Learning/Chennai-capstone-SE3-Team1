import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../generated/trade-client';

export type ConditionType =
  | 'PRICE_AT_OR_ABOVE'
  | 'PRICE_AT_OR_BELOW'
  | 'MA_CROSS_ABOVE'
  | 'MA_CROSS_BELOW'
  | 'BOLLINGER_BELOW_LOWER'
  | 'BOLLINGER_ABOVE_UPPER';

export type OrderSide = 'BUY' | 'SELL';

export interface ConditionSpec {
  type: ConditionType;
  triggerPrice?: number;
  shortWindow?: number;
  longWindow?: number;
  bandWidth?: number;
}

export interface NewConditionalOrder {
  accountId: number;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  idempotencyKey: string;
  condition: ConditionSpec;
  expiresInDays?: number;
}

export interface PlacedOrder {
  orderId: string;
  status: string;
  message: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
}

/** A conditional order still waiting in the book. */
export interface PendingOrder {
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  conditionType: ConditionType;
  condition: string;
  triggerPrice: number | null;
  shortWindow: number | null;
  longWindow: number | null;
  bandWidth: number | null;
  lastState: string | null;
  lastCheckedAt: string | null;
  expiresAt: string;
  createdOn: string;
}

export const CONDITION_LABELS: Readonly<Record<ConditionType, string>> = {
  PRICE_AT_OR_ABOVE: 'Price rises to a level',
  PRICE_AT_OR_BELOW: 'Price falls to a level',
  MA_CROSS_ABOVE: 'Short average crosses above long',
  MA_CROSS_BELOW: 'Short average crosses below long',
  BOLLINGER_BELOW_LOWER: 'Price falls below the lower band',
  BOLLINGER_ABOVE_UPPER: 'Price rises above the upper band'
};

export function newIdempotencyKey(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

@Injectable({ providedIn: 'root' })
export class ConditionalOrderService {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);

  place(order: NewConditionalOrder): Observable<PlacedOrder> {
    return this.http.post<PlacedOrder>(`${this.tradeConfig.basePath}/api/v1/orders/conditional`, order);
  }

  pending(accountId: number): Observable<PendingOrder[]> {
    return this.http.get<PendingOrder[]>(`${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/conditional-orders`);
  }

  cancel(orderId: string): Observable<unknown> {
    return this.http.delete(`${this.tradeConfig.basePath}/api/v1/orders/${encodeURIComponent(orderId)}`);
  }
}
