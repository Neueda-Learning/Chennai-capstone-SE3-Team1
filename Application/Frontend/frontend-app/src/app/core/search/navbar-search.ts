import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { SessionStore } from '../auth/session.store';
import { MarketQuote, MarketService } from '../services/market.service';
import { AccountsService, OrderHistoryEntry } from '../../generated/trade-client';

const MAX_PER_GROUP = 5;

interface TickerHit {
  kind: 'ticker';
  symbol: string;
  label: string;
  detail: string;
}

interface OrderHit {
  kind: 'order';
  orderId: string;
  label: string;
  detail: string;
}

export type SearchHit = TickerHit | OrderHit;

/**
 * The search box in the navbar: finds tickers (by symbol or company name) and your own orders
 * (by order id or symbol). Picking a ticker opens it on the Market page; picking an order opens
 * the blotter filtered to it. The lists are fetched the first time the box is used, not on every
 * page load, and are matched locally as you type.
 */
@Component({
  selector: 'tui-navbar-search',
  templateUrl: './navbar-search.html'
})
export class NavbarSearch {
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly market = inject(MarketService);
  private readonly accounts = inject(AccountsService);

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);

  private readonly quotes = signal<MarketQuote[]>([]);
  private readonly orders = signal<OrderHistoryEntry[]>([]);
  private loaded = false;

  protected readonly tickers = computed<TickerHit[]>(() => {
    const term = this.query().trim().toLowerCase();
    if (term === '') {
      return [];
    }
    return this.quotes()
      .filter((quote) => quote.symbol.toLowerCase().includes(term) || quote.name.toLowerCase().includes(term))
      .slice(0, MAX_PER_GROUP)
      .map((quote) => ({
        kind: 'ticker' as const,
        symbol: quote.symbol,
        label: quote.symbol,
        detail: quote.name
      }));
  });

  protected readonly orderHits = computed<OrderHit[]>(() => {
    const term = this.query().trim().toLowerCase();
    if (term === '') {
      return [];
    }
    return this.orders()
      .filter((order) => order.orderId.toLowerCase().includes(term) || order.symbol.toLowerCase().includes(term))
      .slice(0, MAX_PER_GROUP)
      .map((order) => ({
        kind: 'order' as const,
        orderId: order.orderId,
        label: order.orderId,
        detail: `${order.side} ${order.quantity} ${order.symbol} · ${order.status}`
      }));
  });

  protected readonly hits = computed<SearchHit[]>(() => [...this.tickers(), ...this.orderHits()]);

  constructor() {
    // A different account has different orders; forget the old ones.
    effect(() => {
      this.session.accountId();
      untracked(() => {
        this.orders.set([]);
        this.loaded = false;
      });
    });
  }

  protected onFocus(): void {
    this.open.set(true);
    this.loadOnce();
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.active.set(0);
    this.open.set(true);
    this.loadOnce();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.hits().length;
    if (event.key === 'ArrowDown' && count > 0) {
      event.preventDefault();
      this.active.set((this.active() + 1) % count);
    } else if (event.key === 'ArrowUp' && count > 0) {
      event.preventDefault();
      this.active.set((this.active() - 1 + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = this.hits()[this.active()];
      if (hit) {
        this.choose(hit);
      }
    } else if (event.key === 'Escape') {
      this.close();
    }
  }

  protected onBlur(): void {
    // Delayed so a click on a result lands before the list disappears.
    setTimeout(() => this.open.set(false), 150);
  }

  protected choose(hit: SearchHit): void {
    if (hit.kind === 'ticker') {
      void this.router.navigate(['/orders'], { queryParams: { symbol: hit.symbol } });
    } else {
      void this.router.navigate(['/blotter'], { queryParams: { q: hit.orderId } });
    }
    this.close();
  }

  protected close(): void {
    this.open.set(false);
    this.query.set('');
  }

  private loadOnce(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    this.market
      .getQuotes()
      .pipe(catchError(() => of([] as MarketQuote[])))
      .subscribe((quotes) => this.quotes.set(quotes));

    const accountId = this.session.accountId();
    if (accountId !== null) {
      this.accounts
        .getOrders({ id: accountId })
        .pipe(catchError(() => of([] as OrderHistoryEntry[])))
        .subscribe((orders) => this.orders.set(orders));
    }
  }
}
