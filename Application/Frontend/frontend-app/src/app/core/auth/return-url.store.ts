import { Injectable, signal } from '@angular/core';

import { RETURN_URL_PARAM, sanitiseReturnUrl } from './return-url';

@Injectable({ providedIn: 'root' })
export class ReturnUrlStore {
  private readonly pending = signal<string | null>(null);

  capture(url: string): string {
    const safe = sanitiseReturnUrl(url) ?? '/dashboard';
    this.pending.set(safe);
    return safe;
  }

  consume(candidate?: string | null): string {
    const safe = sanitiseReturnUrl(candidate ?? this.pending());
    this.pending.set(null);
    return safe ?? '/dashboard';
  }

  peek(): string | null {
    return this.pending();
  }

  static readonly param = RETURN_URL_PARAM;
}
