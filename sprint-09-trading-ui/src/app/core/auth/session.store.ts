import { Injectable, computed, signal } from '@angular/core';

/**
 * PLACEHOLDER — owned by Subhash (sprint stories 3 and 4).
 *
 * This is the seam the route guard and the order ticket are written against.
 * Subhash replaces the body of this class with his real token storage; the
 * public surface below is the contract, and nothing outside this file should
 * ever reach past it into `localStorage`, the JWT, or the interceptor.
 *
 * Do not add members here without checking with Samyukhtha, who builds against
 * this surface.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly signedIn = signal(false);
  private readonly account = signal<number | null>(null);

  /**
   * Whether the guard should let a navigation through.
   *
   * Subhash's note matters here: this is a usability control, not a security
   * control. It answers "does this browser hold a usable token", not "is this
   * request allowed" — authorisation is the Trade REST API's decision, taken
   * on every call.
   */
  readonly isSignedIn = computed(() => this.signedIn());

  /**
   * The `accountId` claim carried by the access token, or `null` when the user
   * has not linked a bank account yet. The order ticket renders this
   * read-only; it is never an editable field.
   */
  readonly accountId = computed(() => this.account());

  /** Placeholder for Subhash's login hand-off. */
  signIn(accessToken: string, accountId: number | null = null): void {
    void accessToken;
    this.signedIn.set(true);
    this.account.set(accountId);
  }

  /** Placeholder for Subhash's logout hand-off. */
  signOut(): void {
    this.signedIn.set(false);
    this.account.set(null);
  }
}
