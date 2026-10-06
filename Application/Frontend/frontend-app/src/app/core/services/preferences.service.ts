import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, timeout } from 'rxjs';

import { SessionStore } from '../auth/session.store';
import { Configuration } from '../../generated/trade-client';

export type ChannelKind = 'EMAIL' | 'SMS' | 'PUSH';

export interface Preferences {
  accountId: number;
  defaultAccountId: number;
  channel: ChannelKind | null;
  updatedAt: string;
}

export interface PreferencesUpdate {
  defaultAccountId: number;
  channel: ChannelKind;
}

const APPLY_TIMEOUT_MS = 3000;

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);
  private readonly session = inject(SessionStore);

  get(accountId: number): Observable<Preferences> {
    return this.http.get<Preferences>(this.url(accountId));
  }

  put(accountId: number, update: PreferencesUpdate): Observable<Preferences> {
    return this.http.put<Preferences>(this.url(accountId), update);
  }

  applyDefaultAccount(accountId: number): Observable<boolean> {
    return this.get(accountId).pipe(
      timeout(APPLY_TIMEOUT_MS),
      map((stored) => this.session.selectAccount(stored.defaultAccountId)),
      catchError(() => of(false))
    );
  }

  private url(accountId: number): string {
    return `${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/preferences`;
  }
}
