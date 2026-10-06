import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';

import { search } from '../../core/search/fuzzy';
import { Instrument } from '../../core/services/instrument-catalog.service';
import { formatSignedPercent } from '../../core/format/money';

let nextId = 0;

const LIST_MAX_HEIGHT = 272; // 17rem
const LIST_GAP = 4;
const EDGE = 8;
/** A narrow box (a watchlist in a small column) still gets a list wide enough to read company names. */
const MIN_LIST_WIDTH = 320;
/** Below this much free room under the box, the list opens upwards instead (if there is more room above). */
const MIN_ROOM_BELOW = 180;

/** Where the drop-down sits, in viewport pixels. Fixed, so a card's overflow can never cut it off. */
export interface ListPlacement {
  left: number;
  width: number;
  maxHeight: number;
  /** Set when opening downwards. */
  top: number | null;
  /** Set when opening upwards. */
  bottom: number | null;
}

/** Pure, so it can be tested without a browser layout. */
export function placeList(box: { left: number; right: number; top: number; bottom: number }, viewport: { width: number; height: number }): ListPlacement {
  const below = viewport.height - box.bottom - EDGE - LIST_GAP;
  const above = box.top - EDGE - LIST_GAP;
  const up = below < MIN_ROOM_BELOW && above > below;
  const room = up ? above : below;
  const width = Math.max(0, Math.min(Math.max(box.right - box.left, MIN_LIST_WIDTH), viewport.width - 2 * EDGE));
  // Start at the box's left edge, but slide left if a wider list would run off the right of the screen.
  const left = Math.max(EDGE, Math.min(box.left, viewport.width - EDGE - width));
  return {
    left,
    width,
    maxHeight: Math.max(96, Math.min(LIST_MAX_HEIGHT, room)),
    top: up ? null : box.bottom + LIST_GAP,
    bottom: up ? viewport.height - box.top + LIST_GAP : null
  };
}

/**
 * A search box with a drop-down of instruments. Typing narrows the list with forgiving (fuzzy) matching, so
 * "infsys", "rlnc" or "tata mot" all find what the customer means; nothing has to be typed exactly.
 * One component for both jobs: with {@code multiple} off it picks one instrument (price alerts); with it on it
 * collects several, shown as removable chips (watchlists).
 *
 * The parent owns the selection: pass it in as {@code selected} and update it from {@code selectedChange}.
 */
@Component({
  selector: 'tui-symbol-picker',
  templateUrl: './symbol-picker.html',
  styleUrl: './symbol-picker.css'
})
export class SymbolPicker {
  readonly options = input.required<readonly Instrument[]>();
  readonly selected = input<readonly string[]>([]);
  /** Instruments that cannot be chosen again (already in the watchlist): shown, dimmed, with a note. */
  readonly unavailable = input<readonly string[]>([]);
  readonly unavailableNote = input('Already added');
  readonly multiple = input(false);
  readonly placeholder = input('Search by symbol or company');
  readonly label = input('Search instruments');
  readonly loading = input(false);
  readonly disabled = input(false);
  readonly testId = input('picker');

  readonly selectedChange = output<string[]>();

  protected readonly id = `symbol-picker-${nextId++}`;
  protected readonly listId = `${this.id}-list`;
  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly placement = signal<ListPlacement | null>(null);
  protected readonly formatPercent = formatSignedPercent;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly boxEl = viewChild<ElementRef<HTMLElement>>('box');
  private readonly listEl = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly results = computed(() => search(this.query(), this.options(), 60));
  protected readonly chips = computed(() =>
    this.selected().map((symbol) => this.options().find((o) => o.symbol === symbol) ?? { symbol, name: '', price: null, changePercent: null })
  );
  protected readonly single = computed(() => (!this.multiple() ? (this.chips()[0] ?? null) : null));
  protected readonly activeId = computed(() => {
    const result = this.results()[this.active()];
    return this.open() && result ? this.optionId(result.symbol) : null;
  });

  constructor() {
    // The highlighted row never points past the end of a shorter list.
    effect(() => {
      const count = this.results().length;
      untracked(() => this.active.update((index) => (count === 0 ? 0 : Math.min(index, count - 1))));
    });
    // While open, keep the list tied to the box: it follows scrolling and resizing of the page or any scroller.
    effect((onCleanup) => {
      if (!this.open()) {
        this.placement.set(null);
        return;
      }
      const reposition = () => this.reposition();
      reposition();
      window.addEventListener('resize', reposition);
      window.addEventListener('scroll', reposition, true);
      onCleanup(() => {
        window.removeEventListener('resize', reposition);
        window.removeEventListener('scroll', reposition, true);
      });
    });
    // Keep the highlighted row in view while arrowing through a long list.
    effect(() => {
      const id = this.activeId();
      if (id !== null) {
        untracked(() => {
          const rows = this.listEl()?.nativeElement.querySelectorAll('[role="option"]') ?? [];
          Array.from(rows).find((row) => row.id === id)?.scrollIntoView?.({ block: 'nearest' });
        });
      }
    });
  }

  private reposition(): void {
    const box = this.boxEl()?.nativeElement.getBoundingClientRect();
    if (box) {
      this.placement.set(placeList(box, { width: window.innerWidth, height: window.innerHeight }));
    }
  }

  protected optionId(symbol: string): string {
    return `${this.id}-opt-${symbol}`;
  }

  protected isSelected(symbol: string): boolean {
    return this.selected().includes(symbol);
  }

  protected isUnavailable(symbol: string): boolean {
    return this.unavailable().includes(symbol);
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.active.set(0);
    this.open.set(true);
  }

  protected focusInput(): void {
    this.inputEl()?.nativeElement.focus();
  }

  protected openList(): void {
    if (!this.disabled()) {
      this.open.set(true);
    }
  }

  protected toggleList(): void {
    if (this.disabled()) {
      return;
    }
    this.open.update((open) => !open);
    if (this.open()) {
      this.inputEl()?.nativeElement.focus();
    }
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.results().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open()) {
          this.open.set(true);
          return;
        }
        this.active.update((i) => (count === 0 ? 0 : (i + 1) % count));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!this.open()) {
          this.open.set(true);
          return;
        }
        this.active.update((i) => (count === 0 ? 0 : (i - 1 + count) % count));
        break;
      case 'Home':
        if (this.open() && count > 0) {
          event.preventDefault();
          this.active.set(0);
        }
        break;
      case 'End':
        if (this.open() && count > 0) {
          event.preventDefault();
          this.active.set(count - 1);
        }
        break;
      case 'Enter': {
        if (!this.open()) {
          return;
        }
        event.preventDefault();
        const result = this.results()[this.active()];
        if (result) {
          this.choose(result);
        }
        break;
      }
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.open.set(false);
        }
        break;
      case 'Tab':
        this.open.set(false);
        break;
      case 'Backspace':
        // On an empty box, Backspace takes the last chip back off, as in every tag input.
        if (this.query() === '' && this.multiple() && this.selected().length > 0) {
          this.selectedChange.emit(this.selected().slice(0, -1));
        }
        break;
    }
  }

  protected choose(option: Instrument): void {
    if (this.isUnavailable(option.symbol)) {
      return;
    }
    if (this.multiple()) {
      const next = this.isSelected(option.symbol)
        ? this.selected().filter((s) => s !== option.symbol)
        : [...this.selected(), option.symbol];
      this.selectedChange.emit(next);
      this.inputEl()?.nativeElement.focus();
    } else {
      this.selectedChange.emit([option.symbol]);
      this.query.set('');
      this.open.set(false);
    }
  }

  protected remove(symbol: string): void {
    this.selectedChange.emit(this.selected().filter((s) => s !== symbol));
    this.inputEl()?.nativeElement.focus();
  }

  protected clear(): void {
    this.selectedChange.emit([]);
    this.query.set('');
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onOutsidePointer(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
