import { Injectable } from '@angular/core';
import { AccountsService } from '../../generated/trade-client/api/accounts.service';
import { OrderHistoryEntry, OrderStatus } from '../../generated/trade-client';
import { Observable, Subject, timer } from 'rxjs';
import { switchMap, takeUntil, tap, distinctUntilChanged, map, takeWhile } from 'rxjs/operators';

export interface BlotterRow {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: string;
  executedPrice?: string;
  date: string;
  status: typeof OrderStatus[keyof typeof OrderStatus];
  isWorking: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class BlotterService {
  private readonly POLL_INTERVAL_MS = 2000;
  private readonly MAX_POLL_ATTEMPTS = 15;
  private pollAttempts = 0;
  private destroy$ = new Subject<void>();

  constructor(private accountsService: AccountsService) {}

  fetchOrderHistory(accountId: number): Observable<BlotterRow[]> {
    this.pollAttempts = 0;

    return timer(0, this.POLL_INTERVAL_MS).pipe(
      switchMap(() =>
        this.accountsService.getOrders({ id: accountId }).pipe(
          map(orders => this.formatOrders(orders))
        )
      ),
      takeWhile((rows) => {
        this.pollAttempts++;
        const hasNewOrders = rows.some(r => r.status === OrderStatus.New);
        const withinMaxAttempts = this.pollAttempts < this.MAX_POLL_ATTEMPTS;
        
        if (!hasNewOrders) {
          console.log(
            `[Blotter] Polling stopped: all orders in terminal state (${this.pollAttempts}/${this.MAX_POLL_ATTEMPTS} attempts)`
          );
        } else if (!withinMaxAttempts) {
          console.log(
            `[Blotter] Polling stopped: max attempts reached (${this.pollAttempts}/${this.MAX_POLL_ATTEMPTS})`
          );
        } else {
          console.log(
            `[Blotter] Polling active - ${rows.filter(r => r.status === OrderStatus.New).length} order(s) at NEW status (attempt ${this.pollAttempts}/${this.MAX_POLL_ATTEMPTS})`
          );
        }
        
        return hasNewOrders && withinMaxAttempts;
      }, true),
      takeUntil(this.destroy$)
    );
  }

  refreshOnce(accountId: number): Observable<BlotterRow[]> {
    return this.accountsService.getOrders({ id: accountId }).pipe(
      map(orders => this.formatOrders(orders))
    );
  }

  stopPolling(): void {
    this.destroy$.next();
  }

  private formatOrders(orders: OrderHistoryEntry[]): BlotterRow[] {
    return orders
      .map(order => ({
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        price: this.formatPrice(order.price),
        executedPrice: order.executedPrice ? this.formatPrice(order.executedPrice) : undefined,
        date: this.formatDate(order.createdOn),
        status: order.status,
        isWorking: order.status === OrderStatus.New
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private formatPrice(price: number): string {
    return `₹${price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  }

  private formatDate(createdOn: string): string {
    const date = new Date(createdOn);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
}
