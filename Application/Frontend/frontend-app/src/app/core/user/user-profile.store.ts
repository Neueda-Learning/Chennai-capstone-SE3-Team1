import { Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { ProfileService, UserResponse } from '../../generated/auth-client';
import { AccountResponse, AccountsService } from '../../generated/trade-client';

/**
 * The signed-in person, as the shell shows them: who they are, not what they hold.
 *
 * Identity lives in two places. The auth service knows the login (`username`, `email`,
 * `phone`); the trade account knows the holder's real name (`holderName`), which exists once a
 * bank account is linked. The name shown prefers the holder's name, then the username.
 *
 * Neither service stores a profile picture, so `avatarUrl` is always `null` and the avatar
 * component draws its placeholder. It is a computed value rather than a constant so that when
 * a picture field arrives the shell template does not change.
 */
@Injectable({ providedIn: 'root' })
export class UserProfileStore {
  private readonly profileApi = inject(ProfileService);
  private readonly accountsApi = inject(AccountsService);

  private readonly user = signal<UserResponse | null>(null);
  private readonly account = signal<AccountResponse | null>(null);

  /** The full records, for the My Account page; everything else here is a convenience over them. */
  readonly userRecord = this.user.asReadonly();
  readonly accountRecord = this.account.asReadonly();

  readonly loaded = computed(() => this.user() !== null);
  readonly username = computed(() => this.user()?.username ?? null);
  readonly email = computed(() => this.user()?.email ?? null);
  readonly phone = computed(() => this.user()?.phone ?? null);
  readonly holderName = computed(() => this.account()?.holderName ?? null);

  /** The name to greet them with; `null` until anything is known. */
  readonly displayName = computed(() => this.holderName() ?? this.username());

  /** Up to two letters, for places that want a monogram. */
  readonly initials = computed(() => {
    const name = (this.displayName() ?? '').trim();
    if (name === '') {
      return '';
    }
    const words = name.split(/[\s._-]+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2);
    return letters.toUpperCase();
  });

  readonly avatarUrl = computed<string | null>(() => null);

  /**
   * Fetches the login and, when a bank account is linked, the account holder. A failure of
   * either leaves what is known as it was: the shell then falls back to its generic labels
   * rather than showing an error for a decoration.
   */
  load(accountId: number | null): void {
    forkJoin({
      user: this.profileApi.getCurrentUser().pipe(catchError(() => of(null))),
      account:
        accountId === null
          ? of(null)
          : this.accountsApi.getAccount({ id: accountId }).pipe(catchError(() => of(null)))
    }).subscribe(({ user, account }) => {
      if (user) {
        this.user.set(user);
      }
      this.account.set(account);
    });
  }

  clear(): void {
    this.user.set(null);
    this.account.set(null);
  }
}
