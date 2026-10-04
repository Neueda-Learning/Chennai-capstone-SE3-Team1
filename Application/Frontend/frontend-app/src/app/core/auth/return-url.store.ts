import { Injectable, signal } from '@angular/core';

import { RETURN_URL_PARAM, sanitiseReturnUrl } from './return-url';

/**
 * Holds the destination a signed-out visitor was trying to reach, so the
 * sign-in page can drop them back there afterwards.
 *
 * The query parameter is the carrier, because it survives a full page load and
 * a copied link. The signal is the backstop for the case where it does not:
 * a user who was bounced, then opened `/login` from a bookmark, has no
 * parameter to read but still has somewhere they were going.
 */
@Injectable({ providedIn: 'root' })
export class ReturnUrlStore {
  private readonly pending = signal<string | null>(null);

  /** Called by the guard with the URL that was refused. */
  capture(url: string): string {
    const safe = sanitiseReturnUrl(url) ?? '/dashboard';
    this.pending.set(safe);
    return safe;
  }

  /**
   * Called by the sign-in page once a session exists. Returns the destination
   * and clears it, so a later sign-in does not inherit a stale one.
   */
  consume(candidate?: string | null): string {
    const safe = sanitiseReturnUrl(candidate ?? this.pending());
    this.pending.set(null);
    return safe ?? '/dashboard';
  }

  /** The destination as it stands, without clearing it. */
  peek(): string | null {
    return this.pending();
  }

  /** The parameter name, re-exported so callers need only this one import. */
  static readonly param = RETURN_URL_PARAM;
}
