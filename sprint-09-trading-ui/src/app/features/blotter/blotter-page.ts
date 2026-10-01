import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BlotterService, BlotterRow } from './blotter.service';
import { OrderStatus } from '../../generated/trade-client';
import { OrdersService } from '../../generated/trade-client/api/orders.service';
import { SessionStore } from '../../core/auth/session.store';
import { ErrorCatalog } from '../../core/errors/error-catalog';

@Component({
  selector: 'tui-blotter-page',
  imports: [CommonModule],
  templateUrl: './blotter-page.html',
  styleUrl: './blotter-page.css'
})
export class BlotterPage implements OnInit, OnDestroy {
  // Use signals for reactive state
  rows = signal<BlotterRow[]>([]);
  isLoading = signal(false);
  isRefreshing = signal(false);
  error = signal<string | null>(null);
  isPolling = signal(false);
  
  // Modal state
  selectedOrderForDetails = signal<BlotterRow | null>(null);
  isCancelling = signal<string | null>(null); // Track which order is being cancelled (by orderId)

  // Status constants for template
  readonly OrderStatus = OrderStatus;

  // Inject dependencies
  private readonly session = inject(SessionStore);
  private readonly blotterService = inject(BlotterService);
  private readonly ordersService = inject(OrdersService);
  private readonly errorCatalog = inject(ErrorCatalog);

  ngOnInit(): void {
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.blotterService.stopPolling();
  }

  /**
   * Start polling for order updates. Sets up continuous polling
   * that stops when no orders are at NEW or max attempts reached.
   * 
   * Re-read order history on a bounded interval (2s, max 15 attempts = ~30s)
   * while anything is at NEW, stop when nothing is working, and offer a refresh
   * the user can press. Never re-post the order.
   */
  private startPolling(): void {
    const accountId = this.session.accountId();
    if (!accountId) {
      this.error.set('No account linked to this session. Please complete account setup.');
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.isPolling.set(true);
    this.error.set(null);

    this.blotterService.fetchOrderHistory(accountId).subscribe({
      next: (newRows) => {
        this.rows.set(newRows);
        this.isLoading.set(false);
        
        // Check if any orders are still NEW
        const hasNewOrders = newRows.some(r => r.status === OrderStatus.New);
        const newOrdersCount = newRows.filter(r => r.status === OrderStatus.New).length;
        
        if (!hasNewOrders) {
          // Polling stopped - all orders are terminal
          this.isPolling.set(false);
          if (newOrdersCount === 0 && newRows.length > 0) {
            console.log('[Blotter] Polling complete - all orders in terminal state');
          }
        } else {
          // Still polling for NEW orders
          console.log(
            `[Blotter] Polling active - ${newOrdersCount} order(s) at NEW status`
          );
        }
      },
      error: (err) => {
        console.error('Failed to load order history:', err);
        const errorMsg = this.errorCatalog.messageForTrade(err);
        this.error.set(errorMsg);
        this.isLoading.set(false);
        this.isPolling.set(false);
      },
      complete: () => {
        // Polling completed (either no NEW orders or max attempts reached)
        this.isPolling.set(false);
        console.log('[Blotter] Polling stream completed');
      }
    });
  }

  /**
   * Manual refresh: fetch orders once without continuous polling.
   */
  refreshOrders(): void {
    const accountId = this.session.accountId();
    if (!accountId) {
      this.error.set('No account linked to this session.');
      return;
    }

    this.isRefreshing.set(true);
    this.error.set(null);

    this.blotterService.refreshOnce(accountId).subscribe({
      next: (newRows) => {
        this.rows.set(newRows);
        this.isRefreshing.set(false);
      },
      error: (err) => {
        console.error('Failed to refresh orders:', err);
        const errorMsg = this.errorCatalog.messageForTrade(err);
        this.error.set(errorMsg);
        this.isRefreshing.set(false);
      }
    });
  }

  /**
   * Get badge CSS class based on status.
   */
  getStatusClass(status: string): string {
    switch (status) {
      case OrderStatus.Filled:
        return 'status-filled';
      case OrderStatus.New:
        return 'status-new';
      case OrderStatus.Rejected:
        return 'status-rejected';
      case OrderStatus.Cancelled:
        return 'status-cancelled';
      default:
        return 'status-unknown';
    }
  }

  /**
   * Get status display text.
   */
  getStatusDisplay(status: string): string {
    switch (status) {
      case OrderStatus.New:
        return 'Working';
      case OrderStatus.Filled:
        return 'Filled';
      case OrderStatus.Rejected:
        return 'Rejected';
      case OrderStatus.Cancelled:
        return 'Cancelled';
      default:
        return status;
    }
  }

  /**
   * Show order details in a modal.
   */
  viewOrderDetails(order: BlotterRow): void {
    this.selectedOrderForDetails.set(order);
  }

  /**
   * Close the details modal.
   */
  closeDetailsModal(): void {
    this.selectedOrderForDetails.set(null);
  }

  /**
   * Cancel an order. Only works if order status is NEW.
   */
  cancelOrder(order: BlotterRow): void {
    if (order.status !== OrderStatus.New) {
      this.error.set('Only orders in "Working" status can be cancelled.');
      return;
    }

    // Extract order ID without the "ORD-" prefix
    const orderIdWithoutPrefix = order.orderId.replace(/^ORD-/, '');

    this.isCancelling.set(order.orderId);
    this.error.set(null);

    this.ordersService.cancelOrder({ id: orderIdWithoutPrefix }).subscribe({
      next: () => {
        console.log(`[Blotter] Order ${order.orderId} cancelled successfully`);
        this.isCancelling.set(null);
        
        // Refresh the order list to show updated status
        this.refreshOrders();
      },
      error: (err) => {
        console.error(`Failed to cancel order ${order.orderId}:`, err);
        const errorMsg = this.errorCatalog.messageForTrade(err);
        this.error.set(errorMsg);
        this.isCancelling.set(null);
      }
    });
  }

  /**
   * Check if an order can be cancelled.
   */
  canCancelOrder(order: BlotterRow): boolean {
    return order.status === OrderStatus.New;
  }
}

