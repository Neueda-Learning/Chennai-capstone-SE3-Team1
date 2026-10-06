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

/** An alert the assistant suggests. Nothing exists until the customer confirms it. */
export interface AlertProposal {
  symbol: string;
  threshold: number;
  direction: 'ABOVE' | 'BELOW';
  reason: string;
  currentPrice: number;
  percentFromNow: number;
}

/** A watchlist the assistant suggests: a new one, or stocks to add to one they have. */
export interface WatchlistProposal {
  mode: 'CREATE' | 'ADD';
  name: string;
  watchlistId: string | null;
  symbols: string[];
  reason: string;
}

/** A "go there" button. The path is checked against the app's own pages before it is ever followed. */
export interface NavLink {
  label: string;
  path: string;
  query: Record<string, string>;
}

export interface ChatReply {
  reply: string;
  suggestions: OrderSuggestion[];
  alertProposals?: AlertProposal[];
  watchlistProposals?: WatchlistProposal[];
  links?: NavLink[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);

  send(accountId: number, messages: readonly ChatTurn[]): Observable<ChatReply> {
    return this.http.post<ChatReply>(`${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/chat`, { messages });
  }
}
