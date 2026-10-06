import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Configuration } from '../../generated/trade-client';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface OrderSuggestion {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  reason: string;
}

export interface ChatReply {
  reply: string;
  suggestions: OrderSuggestion[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);

  send(accountId: number, messages: readonly ChatTurn[]): Observable<ChatReply> {
    return this.http.post<ChatReply>(`${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/chat`, { messages });
  }
}
