import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { ErrorCatalog } from '../errors/error-catalog';
import { SessionStore } from '../auth/session.store';
import { ChatService, ChatTurn, OrderSuggestion } from './chat.service';

export interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
  suggestions: OrderSuggestion[];
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
    this.messages.update((all) => [...all, { role: 'user', text: clean, suggestions: [] }]);
    this.sending.set(true);

    this.chat.send(accountId, this.payload()).subscribe({
      next: (reply) => {
        this.messages.update((all) => [
          ...all,
          { role: 'assistant', text: reply.reply, suggestions: reply.suggestions ?? [] }
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
        (entry): entry is ChatEntry =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry.role === 'user' || entry.role === 'assistant') &&
          typeof entry.text === 'string' &&
          Array.isArray(entry.suggestions)
      )
      .slice(-MAX_KEPT);
  } catch {
    return [];
  }
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
