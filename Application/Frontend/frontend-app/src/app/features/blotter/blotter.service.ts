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

/**
 * BlotterService manages order history fetching and polling for account orders.
 * 
 * Polling behavior:
 * - Initial fetch happens immediately
 * - Polls every 2 seconds while any order is at NEW status
 * - Stops polling when all orders are in terminal state (FILLED, REJECTED, CANCELLED)
 * - Maximum 15 attempts (~30 seconds) to prevent infinite loops
 */
@Injectable({
  providedIn: 'root'
})
export class BlotterService {
  private readonly POLL_INTERVAL_MS = 2000;
  private readonly MAX_POLL_ATTEMPTS = 15;
  private pollAttempts = 0;
  private destroy$ = new Subject<void>();

  constructor(private accountsService: AccountsService) {}

  /**
   * Fetches order history for an account and sets up polling for NEW orders.
   * Returns an Observable of formatted blotter rows, newest first.
   * 
   * Polling stops when:
   * 1. No orders are at NEW status
   * 2. Max attempts (15) are reached (~30 seconds)
   * 
   * IMPORTANT: Emits on EVERY poll while polling is active, so component can see
   * status transitions (NEW → FILLED/REJECTED). Only skips duplicates within the
   * same poll cycle, not between cycles.
   */
  fetchOrderHistory(accountId: number): Observable<BlotterRow[]> {
    this.pollAttempts = 0;

    // Start with immediate request, then poll on interval
    return timer(0, this.POLL_INTERVAL_MS).pipe(
      switchMap(() =>
        this.accountsService.getOrders({ id: accountId }).pipe(
          map(orders => this.formatOrders(orders))
        )
      ),
      // Emit EVERY response while polling is active, including status changes
      // Stop polling when: (1) no NEW orders remain OR (2) max attempts reached
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
      }, true), // true = emit the final value that triggered the stop condition
      takeUntil(this.destroy$)
    );
  }

  /**
   * Manually refresh order history once without continuous polling.
   */
  refreshOnce(accountId: number): Observable<BlotterRow[]> {
    return this.accountsService.getOrders({ id: accountId }).pipe(
      map(orders => this.formatOrders(orders))
    );
  }

  /**
   * Stop any ongoing polling.
   */
  stopPolling(): void {
    this.destroy$.next();
  }

  /**
   * Format raw OrderHistoryEntry array into BlotterRow format.
   * Sorts newest first (reverse chronological).
   */
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
      // Sort newest first
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  /**
   * Format price with 2 decimal places and rupee symbol.
   */
  private formatPrice(price: number): string {
    return `₹${price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  }

  /**
   * Format ISO datetime to readable format (e.g., "Feb 14, 2026").
   */
  private formatDate(createdOn: string): string {
    const date = new Date(createdOn);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
}
