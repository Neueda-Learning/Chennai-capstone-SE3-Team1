import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BlotterService, BlotterRow } from './blotter.service';
import { OrderStatus } from '../../generated/trade-client';
import { OrdersService } from '../../generated/trade-client/api/orders.service';
import { SessionStore } from '../../core/auth/session.store';
import { ErrorCatalog } from '../../core/errors/error-catalog';

@Component({
  selector: 'tui-blotter-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './blotter-page.html',
  styleUrl: './blotter-page.css'
})
export class BlotterPage implements OnInit, OnDestroy {
  rows = signal<BlotterRow[]>([]);
  isLoading = signal(false);
  isRefreshing = signal(false);
  error = signal<string | null>(null);
  isPolling = signal(false);
  
  selectedOrderForDetails = signal<BlotterRow | null>(null);
  isCancelling = signal<string | null>(null);

  searchText = signal('');
  selectedStatus = signal<OrderStatus | 'ALL'>('ALL');
  selectedSide = signal<'BUY' | 'SELL' | 'ALL'>('ALL');
  timeFrame = signal<'today' | 'week' | 'month' | 'all'>('all');
  currentPage = signal(1);
  pageSize = signal(10);

  readonly OrderStatus = OrderStatus;
  readonly Math = Math;
  readonly Array = Array;
  readonly timeFrameOptions = [
    { label: 'Today', value: 'today' as const },
    { label: 'Last 7 Days', value: 'week' as const },
    { label: 'Last 30 Days', value: 'month' as const },
    { label: 'All Time', value: 'all' as const }
  ];

  private readonly session = inject(SessionStore);
  private readonly blotterService = inject(BlotterService);
  private readonly ordersService = inject(OrdersService);
  private readonly errorCatalog = inject(ErrorCatalog);
  private readonly route = inject(ActivatedRoute, { optional: true });

  private readonly queryFilter = this.route?.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
    const q = params.get('q');
    if (q !== null) {
      this.searchText.set(q);
      this.currentPage.set(1);
    }
  });

  filteredRows = computed(() => {
    let filtered = this.rows();

    const timeFrame = this.timeFrame();
    if (timeFrame !== 'all') {
      const now = new Date();
      const startDate = new Date();
      
      if (timeFrame === 'today') {
        startDate.setHours(0, 0, 0, 0);
      } else if (timeFrame === 'week') {
        startDate.setDate(startDate.getDate() - 7);
      } else if (timeFrame === 'month') {
        startDate.setMonth(startDate.getMonth() - 1);
      }

      filtered = filtered.filter(row => {
        const rowDate = new Date(row.date);
        return rowDate >= startDate && rowDate <= now;
      });
    }

    if (this.selectedStatus() !== 'ALL') {
      filtered = filtered.filter(row => row.status === this.selectedStatus());
    }

    if (this.selectedSide() !== 'ALL') {
      filtered = filtered.filter(row => row.side === this.selectedSide());
    }

    const search = this.searchText().toLowerCase();
    if (search) {
      filtered = filtered.filter(row =>
        row.orderId.toLowerCase().includes(search) ||
        row.symbol.toLowerCase().includes(search)
      );
    }

    return filtered;
  });

  paginatedRows = computed(() => {
    const filtered = this.filteredRows();
    const start = (this.currentPage() - 1) * this.pageSize();
    const end = start + this.pageSize();
    return filtered.slice(start, end);
  });

  totalPages = computed(() => {
    return Math.ceil(this.filteredRows().length / this.pageSize());
  });

  ngOnInit(): void {
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.blotterService.stopPolling();
  }

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
        
        const hasNewOrders = newRows.some(r => r.status === OrderStatus.New);
        const newOrdersCount = newRows.filter(r => r.status === OrderStatus.New).length;
        
        if (!hasNewOrders) {
          this.isPolling.set(false);
          if (newOrdersCount === 0 && newRows.length > 0) {
            console.log('[Blotter] Polling complete - all orders in terminal state');
          }
        } else {
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
        this.isPolling.set(false);
        console.log('[Blotter] Polling stream completed');
      }
    });
  }

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

  getStatusClass(status: string): string {
    switch (status) {
      case OrderStatus.Filled:
        return 'success';
      case OrderStatus.New:
        return 'pending';
      case OrderStatus.Rejected:
        return 'failed';
      case OrderStatus.Cancelled:
        return 'cancelled';
      default:
        return '';
    }
  }

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

  viewOrderDetails(order: BlotterRow): void {
    this.selectedOrderForDetails.set(order);
  }

  closeDetailsModal(): void {
    this.selectedOrderForDetails.set(null);
  }

  onFilterChange(): void {
    this.currentPage.set(1);
  }

  clearFilters(): void {
    this.searchText.set('');
    this.selectedStatus.set('ALL');
    this.selectedSide.set('ALL');
    this.timeFrame.set('all');
    this.currentPage.set(1);
  }

  hasActiveFilters(): boolean {
    return (
      this.searchText() !== '' ||
      this.selectedStatus() !== 'ALL' ||
      this.selectedSide() !== 'ALL' ||
      this.timeFrame() !== 'all'
    );
  }

  previousPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.set(this.currentPage() - 1);
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.set(this.currentPage() + 1);
    }
  }

  cancelOrder(order: BlotterRow): void {
    if (order.status !== OrderStatus.New) {
      this.error.set('Only orders in "Working" status can be cancelled.');
      return;
    }

    const orderIdWithoutPrefix = order.orderId.replace(/^ORD-/, '');

    this.isCancelling.set(order.orderId);
    this.error.set(null);

    this.ordersService.cancelOrder({ id: orderIdWithoutPrefix }).subscribe({
      next: () => {
        console.log(`[Blotter] Order ${order.orderId} cancelled successfully`);
        this.isCancelling.set(null);
        
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

  canCancelOrder(order: BlotterRow): boolean {
    return order.status === OrderStatus.New;
  }
}

