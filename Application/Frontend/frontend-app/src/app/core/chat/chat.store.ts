import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { ErrorCatalog } from '../errors/error-catalog';
import { SessionStore } from '../auth/session.store';
import { WatchlistStore } from '../watchlists/watchlist.store';
import { AlertProposal, ChatService, ChatTurn, NavLink, OrderSuggestion, WatchlistProposal } from './chat.service';

export type CardStatus = 'idle' | 'working' | 'done' | 'failed' | 'dismissed';

/** A proposal and what the customer has done with it. Only a confirmed one ever reaches the server. */
export interface Card<T> {
  proposal: T;
  status: CardStatus;
  note: string | null;
}

export interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
  suggestions: OrderSuggestion[];
  alerts: Card<AlertProposal>[];
  lists: Card<WatchlistProposal>[];
  links: NavLink[];
}

/** The pages a "go there" button may open: the app's own, nothing else. */
const APP_PATHS = new Set([
  '/app/dashboard',
  '/app/portfolio',
  '/app/orders',
  '/app/blotter',
  '/app/watchlists',
  '/app/account',
  '/app/settings',
  '/app/bank-accounts'
]);

export function isAppLink(link: NavLink): boolean {
  return typeof link === 'object' && link !== null && typeof link.path === 'string' && APP_PATHS.has(link.path);
}

/** Matches the server's limits (ChatRequest): more than this is refused with VAL-422. */
export const MAX_MESSAGES_SENT = 20;
export const MAX_TEXT = 1500;
const STORAGE_KEY = 'tui.chat.v1';
const MAX_KEPT = 40;

@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly chat = inject(ChatService);
  private readonly session = inject(SessionStore);
  private readonly errors = inject(ErrorCatalog);
  private readonly workspace = inject(WatchlistStore);
  private readonly newer = new WeakMap<ChatEntry, ChatEntry>();

  readonly open = signal(false);
  readonly messages = signal<ChatEntry[]>(restore());
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  /** The text of a message that could not be sent, so the box can offer it back instead of losing it. */
  readonly draft = signal<string | null>(null);

  /** The assistant needs an account to look at; without one the launcher is not shown. */
  readonly available = computed(() => this.session.isSignedIn() && this.session.accountId() !== null);

  constructor() {
    effect(() => {
      if (!this.session.isSignedIn()) {
        this.clear();
        this.open.set(false);
      }
    });
    effect(() => persist(this.messages()));
  }

  toggle(): void {
    this.open.update((open) => !open);
  }

  close(): void {
    this.open.set(false);
  }

  clear(): void {
    this.messages.set([]);
    this.error.set(null);
    this.draft.set(null);
  }

  send(text: string): void {
    const accountId = this.session.accountId();
    const clean = text.trim();
    if (this.sending() || accountId === null || clean === '' || clean.length > MAX_TEXT) {
      return;
    }
    this.error.set(null);
    this.draft.set(null);
    this.messages.update((all) => [...all, { role: 'user', text: clean, suggestions: [], alerts: [], lists: [], links: [] }]);
    this.sending.set(true);

    this.chat.send(accountId, this.payload()).subscribe({
      next: (reply) => {
        this.messages.update((all) => [
          ...all,
          {
            role: 'assistant',
            text: reply.reply,
            suggestions: reply.suggestions ?? [],
            alerts: (reply.alertProposals ?? []).map((proposal) => card(proposal)),
            lists: (reply.watchlistProposals ?? []).map((proposal) => card(proposal)),
            links: (reply.links ?? []).filter(isAppLink)
          }
        ]);
        this.sending.set(false);
      },
      error: (failure: unknown) => {
        // Take the unanswered question back out of the conversation and hand its text back to the box.
        this.messages.update((all) => all.slice(0, -1));
        this.draft.set(clean);
        this.error.set(this.errors.messageForTrade(failure));
        this.sending.set(false);
      }
    });
  }

  /** The customer confirmed an alert: this click, and only this, creates it. */
  confirmAlert(entry: ChatEntry, index: number): void {
    const target = entry.alerts[index];
    if (target === undefined || (target.status !== 'idle' && target.status !== 'failed')) {
      return;
    }
    const { symbol, threshold, direction } = target.proposal;
    this.setCard(entry, 'alerts', index, 'working', null);
    this.workspace.createAlert({ symbol, threshold, direction }).subscribe((ok) =>
      ok
        ? this.setCard(entry, 'alerts', index, 'done', null)
        : this.setCard(entry, 'alerts', index, 'failed', this.workspace.alertError() ?? 'The alert could not be set.')
    );
  }

  /** The customer confirmed a watchlist: create it (or use theirs) and put the stocks in. */
  confirmList(entry: ChatEntry, index: number): void {
    const target = entry.lists[index];
    if (target === undefined || (target.status !== 'idle' && target.status !== 'failed')) {
      return;
    }
    const { mode, name, watchlistId, symbols } = target.proposal;
    this.setCard(entry, 'lists', index, 'working', null);
    const fail = (): void =>
      this.setCard(entry, 'lists', index, 'failed', this.workspace.error() ?? 'The watchlist could not be saved.');
    const fill = (id: string): void =>
      void this.workspace.addInstruments(id, symbols).subscribe((outcome) => {
        if (outcome.failed.length === 0) {
          this.setCard(entry, 'lists', index, 'done', null);
        } else if (outcome.added.length === 0) {
          fail();
        } else {
          this.setCard(entry, 'lists', index, 'done', `Added ${outcome.added.length}; ${outcome.failed.join(', ')} could not be added.`);
        }
      });

    if (mode === 'ADD' && watchlistId !== null) {
      fill(watchlistId);
      return;
    }
    this.workspace.createWatchlist(name).subscribe((ok) => {
      const created = ok ? this.workspace.watchlists().filter((w) => w.name === name.trim()).at(-1) : undefined;
      if (created === undefined) {
        fail();
      } else {
        fill(created.id);
      }
    });
  }

  dismiss(entry: ChatEntry, kind: 'alerts' | 'lists', index: number): void {
    this.setCard(entry, kind, index, 'dismissed', null);
  }

  /**
   * Cards live inside entries, and an entry is replaced when one changes. A request that finishes later still holds
   * the old object, so each replacement is remembered and the newest version is looked up before changing it.
   */
  private setCard(entry: ChatEntry, kind: 'alerts' | 'lists', index: number, status: CardStatus, note: string | null): void {
    let live = entry;
    while (this.newer.has(live)) {
      live = this.newer.get(live) as ChatEntry;
    }
    const next = { ...live, [kind]: live[kind].map((c, i) => (i === index ? { ...c, status, note } : c)) } as ChatEntry;
    this.newer.set(live, next);
    this.messages.update((all) => all.map((current) => (current === live ? next : current)));
  }

  /** The recent conversation in the server's terms: starts with a user turn, each text within the limit. */
  private payload(): ChatTurn[] {
    const recent = this.messages()
      .slice(-MAX_MESSAGES_SENT)
      .map((entry): ChatTurn => ({ role: entry.role, text: entry.text.slice(0, MAX_TEXT) }));
    const firstUser = recent.findIndex((turn) => turn.role === 'user');
    return firstUser < 0 ? [] : recent.slice(firstUser);
  }
}

function restore(): ChatEntry[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry.role === 'user' || entry.role === 'assistant') &&
          typeof entry.text === 'string' &&
          Array.isArray(entry.suggestions)
      )
      .map(
        (entry): ChatEntry => ({
          role: entry.role,
          text: entry.text,
          suggestions: entry.suggestions,
          alerts: restoreCards(entry.alerts),
          lists: restoreCards(entry.lists),
          links: Array.isArray(entry.links) ? entry.links.filter(isAppLink) : []
        })
      )
      .slice(-MAX_KEPT);
  } catch {
    return [];
  }
}

function card<T>(proposal: T): Card<T> {
  return { proposal, status: 'idle', note: null };
}

/** Saved cards come back as they were, except one caught mid-request or failed goes back to waiting for a click. */
function restoreCards<T>(saved: unknown): Card<T>[] {
  if (!Array.isArray(saved)) {
    return [];
  }
  return saved
    .filter((c) => typeof c === 'object' && c !== null && typeof c.proposal === 'object' && c.proposal !== null)
    .map(
      (c): Card<T> => ({
        proposal: c.proposal as T,
        status: c.status === 'done' || c.status === 'dismissed' ? c.status : 'idle',
        note: typeof c.note === 'string' ? c.note : null
      })
    );
}

function persist(messages: ChatEntry[]): void {
  try {
    if (messages.length === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_KEPT)));
    }
  } catch {
    // Storage can be unavailable (private windows, blocked site data); the chat still works without it.
  }
}
