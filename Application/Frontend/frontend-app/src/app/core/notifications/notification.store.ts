import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { Subscription, of, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { Configuration } from '../../generated/trade-client';

export type NotificationKind =
  | 'ORDER_PLACED'
  | 'ORDER_FILLED'
  | 'ORDER_REJECTED'
  | 'ORDER_CANCELLED'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT';

/** One thing that happened to the account, as `GET /api/v1/accounts/{id}/notifications` says. */
export interface AccountNotification {
  /** Stable for a given event, so the same event is never announced twice. */
  id: string;
  kind: NotificationKind;
  /** A sentence ready to show. */
  message: string;
  symbol: string | null;
  side: 'BUY' | 'SELL' | null;
  quantity: number | null;
  price: number | null;
  executedPrice: number | null;
  amount: number | null;
  reason: string | null;
  /** ISO-8601 with the offset the server computed it in, so it reads right in any browser timezone. */
  occurredAt: string;
}

export type Tone = 'success' | 'danger' | 'warning' | 'info';

/** The pop-up shown for a notification that arrived while the app was open. */
export interface Toast {
  id: string;
  kind: NotificationKind;
  message: string;
}

/** How the store tells the time. Injectable so specs do not wait on real timers. */
export const NOTIFICATION_POLL_MS = new InjectionToken<number>('Notification poll interval (ms)', {
  factory: () => 10_000
});

/** How long a pop-up stays before it dismisses itself. */
export const TOAST_LIFETIME_MS = new InjectionToken<number>('Toast lifetime (ms)', {
  factory: () => 7_000
});

const POPUPS_KEY = 'trading-ui.notifications.popups';
const READ_KEY_PREFIX = 'trading-ui.notifications.read.';
const MAX_REMEMBERED_READS = 300;
const MAX_TOASTS = 4;
const FETCH_LIMIT = 30;

/**
 * Real account notifications, for the bell in the navbar and the pop-ups at the bottom right.
 *
 * Nothing is pushed to the browser, so this polls. Each poll replaces the list; anything whose
 * id has not been seen before in this session, and that the user has not already read, pops up
 * once. The first poll after sign-in never pops anything up: those are the things that
 * happened while the user was away, and they sit in the bell as unread instead of arriving as
 * a burst of toasts.
 *
 * "Read" is remembered per account in this browser. An account's very first poll on a browser
 * that has never seen it treats the existing history as read, so a new device does not greet
 * someone with a badge for everything they have ever done.
 */
@Injectable({ providedIn: 'root' })
export class NotificationStore {
  private readonly http = inject(HttpClient);
  private readonly tradeConfig = inject(Configuration);
  private readonly pollMs = inject(NOTIFICATION_POLL_MS);
  private readonly toastLifetimeMs = inject(TOAST_LIFETIME_MS);

  private readonly itemsSignal = signal<AccountNotification[]>([]);
  private readonly readIds = signal<ReadonlySet<string>>(new Set());
  private readonly toastsSignal = signal<Toast[]>([]);
  private readonly nowSignal = signal(Date.now());
  private readonly failedSignal = signal(false);
  private readonly changesSignal = signal(0);
  private readonly popupsSignal = signal(NotificationStore.readPopupsPreference());

  private accountId: number | null = null;
  private seen = new Set<string>();
  private firstPollDone = false;
  private subscription: Subscription | null = null;
  private pollNow: (() => void) | null = null;
  private readonly toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly items = this.itemsSignal.asReadonly();
  readonly toasts = this.toastsSignal.asReadonly();
  readonly now = this.nowSignal.asReadonly();
  /** True when the last poll failed; the list shown is then the last good one. */
  readonly failed = this.failedSignal.asReadonly();

  /**
   * Counts the polls that found something new. An order filling or a transfer landing changes the
   * balance and holdings behind it, so the pages showing those watch this and reload; the
   * first poll after sign-in does not count, as nothing has *happened* then.
   */
  readonly changes = this.changesSignal.asReadonly();

  /** Whether new notifications also pop up. Off still fills the bell and its badge. */
  readonly popupsEnabled = this.popupsSignal.asReadonly();

  setPopupsEnabled(enabled: boolean): void {
    this.popupsSignal.set(enabled);
    try {
      localStorage.setItem(POPUPS_KEY, enabled ? 'on' : 'off');
    } catch {
      // The choice still holds for this tab.
    }
    if (!enabled) {
      this.toastTimers.forEach((handle) => clearTimeout(handle));
      this.toastTimers.clear();
      this.toastsSignal.set([]);
    }
  }

  private static readPopupsPreference(): boolean {
    try {
      return localStorage.getItem(POPUPS_KEY) !== 'off';
    } catch {
      return true;
    }
  }

  readonly unreadCount = computed(() => {
    const read = this.readIds();
    return this.itemsSignal().filter((item) => !read.has(item.id)).length;
  });

  isRead(id: string): boolean {
    return this.readIds().has(id);
  }

  /** Starts (or restarts, for a different account) polling. Safe to call repeatedly. */
  start(accountId: number): void {
    if (this.accountId === accountId && this.subscription !== null) {
      return;
    }
    this.stop();
    this.accountId = accountId;
    this.loadReadIds(accountId);

    const url = `${this.tradeConfig.basePath}/api/v1/accounts/${accountId}/notifications`;
    const trigger = new Subscription();
    this.subscription = trigger;

    const poll = timer(0, this.pollMs).pipe(
      switchMap(() =>
        this.http
          .get<AccountNotification[]>(url, { params: { limit: FETCH_LIMIT } })
          .pipe(catchError(() => of(null)))
      )
    );
    trigger.add(poll.subscribe((items) => this.onPoll(accountId, items)));
    this.pollNow = () => {
      trigger.add(
        this.http
          .get<AccountNotification[]>(url, { params: { limit: FETCH_LIMIT } })
          .pipe(catchError(() => of(null)))
          .subscribe((items) => this.onPoll(accountId, items))
      );
    };
  }

  /** Stops polling and forgets everything about the account (sign-out, account change). */
  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.pollNow = null;
    this.accountId = null;
    this.seen = new Set();
    this.firstPollDone = false;
    this.itemsSignal.set([]);
    this.readIds.set(new Set());
    this.failedSignal.set(false);
    this.changesSignal.set(0);
    this.toastTimers.forEach((handle) => clearTimeout(handle));
    this.toastTimers.clear();
    this.toastsSignal.set([]);
  }

  /** Polls right now instead of waiting for the next tick, e.g. just after placing an order. */
  refresh(): void {
    this.pollNow?.();
  }

  markAllRead(): void {
    const next = new Set(this.readIds());
    this.itemsSignal().forEach((item) => next.add(item.id));
    this.setReadIds(next);
  }

  markRead(id: string): void {
    if (this.readIds().has(id)) {
      return;
    }
    this.setReadIds(new Set(this.readIds()).add(id));
  }

  dismissToast(id: string): void {
    const handle = this.toastTimers.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.toastTimers.delete(id);
    }
    this.toastsSignal.update((toasts) => toasts.filter((toast) => toast.id !== id));
  }

  private onPoll(accountId: number, items: AccountNotification[] | null): void {
    if (this.accountId !== accountId) {
      return; // a response for an account that is no longer the current one
    }
    this.nowSignal.set(Date.now());
    if (items === null) {
      this.failedSignal.set(true);
      return;
    }
    this.failedSignal.set(false);

    if (!this.firstPollDone) {
      this.firstPollDone = true;
      this.seen = new Set(items.map((item) => item.id));
      if (!this.hasStoredReads(accountId)) {
        this.setReadIds(new Set(this.seen));
      }
    } else {
      const read = this.readIds();
      const fresh = items.filter((item) => !this.seen.has(item.id));
      if (fresh.length > 0) {
        this.changesSignal.update((n) => n + 1);
      }
      fresh
        .reverse() // oldest of the new ones first, so the newest ends up on top
        .forEach((item) => {
          this.seen.add(item.id);
          if (!read.has(item.id) && this.popupsSignal()) {
            this.pushToast(item);
          }
        });
    }
    this.itemsSignal.set(items);
  }

  private pushToast(item: AccountNotification): void {
    const toast: Toast = { id: item.id, kind: item.kind, message: item.message };
    this.toastsSignal.update((toasts) => [...toasts, toast].slice(-MAX_TOASTS));
    this.toastTimers.set(
      item.id,
      setTimeout(() => this.dismissToast(item.id), this.toastLifetimeMs)
    );
  }

  private storageKey(accountId: number): string {
    return READ_KEY_PREFIX + accountId;
  }

  private hasStoredReads(accountId: number): boolean {
    try {
      return localStorage.getItem(this.storageKey(accountId)) !== null;
    } catch {
      return false;
    }
  }

  private loadReadIds(accountId: number): void {
    try {
      const raw = localStorage.getItem(this.storageKey(accountId));
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      this.readIds.set(new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []));
    } catch {
      this.readIds.set(new Set());
    }
  }

  private setReadIds(ids: Set<string>): void {
    this.readIds.set(ids);
    if (this.accountId === null) {
      return;
    }
    try {
      localStorage.setItem(
        this.storageKey(this.accountId),
        JSON.stringify([...ids].slice(-MAX_REMEMBERED_READS))
      );
    } catch {
      // Not remembering a read across visits is harmless.
    }
  }
}

/** The icon and colour a notification kind is drawn with. */
export function notificationStyle(kind: NotificationKind): { icon: string; tone: Tone } {
  switch (kind) {
    case 'ORDER_FILLED':
      return { icon: 'bi-check2-circle', tone: 'success' };
    case 'ORDER_REJECTED':
      return { icon: 'bi-x-circle', tone: 'danger' };
    case 'ORDER_CANCELLED':
      return { icon: 'bi-slash-circle', tone: 'warning' };
    case 'ORDER_PLACED':
      return { icon: 'bi-hourglass-split', tone: 'warning' };
    case 'TRANSFER_IN':
      return { icon: 'bi-arrow-down-left-circle', tone: 'info' };
    case 'TRANSFER_OUT':
      return { icon: 'bi-arrow-up-right-circle', tone: 'info' };
  }
}

/** "just now", "5 mins ago", "3 hours ago", else the date. */
export function timeAgo(occurredAt: string, now: number): string {
  const then = new Date(occurredAt).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  return new Date(then).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
