import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../generated/trade-client';
import { ChannelKind } from './preferences.service';

export type DeliveryStatus = 'PENDING_CHANNEL' | 'QUEUED' | 'SENT' | 'FAILED';
export type NotificationKind = 'ORDER_FILLED' | 'ORDER_REJECTED' | 'ORDER_CANCELLED' | 'PRICE_ALERT';

export interface NotificationHistoryEntry {
  id: string;
  kind: NotificationKind;
  message: string;
  channel: ChannelKind | null;
  status: DeliveryStatus;
  createdAt: string;
  deliveredAt: string | null;
}

export interface HistoryPage {
  limit?: number;
  before?: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationHistoryService {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);

  list(accountId: number, page: HistoryPage = {}): Observable<NotificationHistoryEntry[]> {
    let params = new HttpParams();
    if (page.limit !== undefined) {
      params = params.set('limit', page.limit);
    }
    if (page.before !== undefined) {
      params = params.set('before', page.before);
    }
    return this.http.get<NotificationHistoryEntry[]>(
      `${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/notification-history`,
      { params }
    );
  }
}
