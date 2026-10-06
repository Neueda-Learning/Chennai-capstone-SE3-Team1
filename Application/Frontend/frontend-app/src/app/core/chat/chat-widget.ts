import { Component, ElementRef, HostListener, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { Block, parseMessage } from './chat-format';
import { OrderSuggestion } from './chat.service';
import { ChatStore, MAX_TEXT } from './chat.store';

/** Where a "consider this order" button goes: the order page, pre-filled. The customer still presses Buy or Sell. */
export function orderLink(suggestion: OrderSuggestion): { symbol: string; side: string; quantity: number } {
  return { symbol: suggestion.symbol, side: suggestion.side, quantity: suggestion.quantity };
}

@Component({
  selector: 'tui-chat-widget',
  templateUrl: './chat-widget.html',
  styleUrl: './chat-widget.css'
})
export class ChatWidget {
  protected readonly store = inject(ChatStore);
  private readonly router = inject(Router);

  protected readonly maxText = MAX_TEXT;
  protected readonly text = signal('');
  protected readonly starters = [
    'How is my portfolio doing?',
    'Is my portfolio too risky?',
    'Which of my stocks looks weakest?'
  ];

  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');
  private readonly parsed = new WeakMap<object, Block[]>();

  constructor() {
    // Keep the newest message in view as the conversation grows.
    effect(() => {
      this.store.messages();
      this.store.sending();
      untracked(() => setTimeout(() => this.scrollToEnd()));
    });
    // A message that could not be sent comes back into the box.
    effect(() => {
      const draft = this.store.draft();
      if (draft !== null) {
        untracked(() => {
          if (this.text() === '') {
            this.text.set(draft);
          }
          this.store.draft.set(null);
        });
      }
    });
    // Focus the box when the panel opens.
    effect(() => {
      if (this.store.open()) {
        untracked(() => setTimeout(() => this.box()?.nativeElement.focus()));
      }
    });
  }

  protected blocks(entry: object & { text: string }): Block[] {
    let blocks = this.parsed.get(entry);
    if (blocks === undefined) {
      blocks = parseMessage(entry.text);
      this.parsed.set(entry, blocks);
    }
    return blocks;
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submit();
    }
  }

  protected submit(): void {
    const value = this.text();
    if (value.trim() === '' || this.store.sending()) {
      return;
    }
    this.text.set('');
    this.store.send(value);
  }

  protected ask(question: string): void {
    this.store.send(question);
  }

  protected openOrder(suggestion: OrderSuggestion): void {
    void this.router.navigate(['/app/orders'], { queryParams: orderLink(suggestion) });
    this.store.close();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.store.open()) {
      this.store.close();
    }
  }

  private scrollToEnd(): void {
    const element = this.log()?.nativeElement;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }
}
