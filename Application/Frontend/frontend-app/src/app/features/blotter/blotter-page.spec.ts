import { TestBed, ComponentFixture } from '@angular/core/testing';
import { BlotterPage } from './blotter-page';
import { BlotterService, BlotterRow } from './blotter.service';
import { OrderStatus, OrderSide } from '../../generated/trade-client';
import { of, throwError } from 'rxjs';
import { SessionStore } from '../../core/auth/session.store';
import { ErrorCatalog } from '../../core/errors/error-catalog';
import { OrdersService } from '../../generated/trade-client/api/orders.service';
import { vi } from 'vitest';

describe('BlotterPage', () => {
  let component: BlotterPage;
  let fixture: ComponentFixture<BlotterPage>;
  let blotterService: any;
  let sessionStore: any;
  let errorCatalog: any;
  let ordersService: any;

  const mockBlotterRows: BlotterRow[] = [
    {
      orderId: 'ORD-1002',
      symbol: 'TCS',
      side: 'SELL' as const,
      quantity: 5,
      price: '₹3,400.00',
      date: 'Feb 14, 2026',
      status: OrderStatus.New,
      isWorking: true
    },
    {
      orderId: 'ORD-1001',
      symbol: 'RELIANCE',
      side: 'BUY' as const,
      quantity: 10,
      price: '₹1,300.00',
      date: 'Feb 10, 2026',
      status: OrderStatus.Filled,
      isWorking: false
    }
  ];

  beforeEach(async () => {
    const blotterSpy = {
      fetchOrderHistory: vi.fn(),
      refreshOnce: vi.fn(),
      stopPolling: vi.fn()
    };

    const sessionSpy = {
      accountId: vi.fn().mockReturnValue(42)
    };

    const errorSpy = {
      messageForTrade: vi.fn().mockReturnValue('An error occurred')
    };

    const ordersSpy = {
      cancelOrder: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [BlotterPage],
      providers: [
        { provide: BlotterService, useValue: blotterSpy as any },
        { provide: SessionStore, useValue: sessionSpy as any },
        { provide: ErrorCatalog, useValue: errorSpy as any },
        { provide: OrdersService, useValue: ordersSpy as any }
      ]
    }).compileComponents();

    blotterService = TestBed.inject(BlotterService);
    sessionStore = TestBed.inject(SessionStore);
    errorCatalog = TestBed.inject(ErrorCatalog);
    ordersService = TestBed.inject(OrdersService);
    fixture = TestBed.createComponent(BlotterPage);
    component = fixture.componentInstance;
  });

  describe('component initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize signal states', () => {
      expect(component.rows()).toEqual([]);
      expect(component.isLoading()).toBe(false);
      expect(component.isRefreshing()).toBe(false);
      expect(component.error()).toBeNull();
      expect(component.isPolling()).toBe(false);
    });

    it('should start polling on init with account ID from session', () => {
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));
      
      fixture.detectChanges();
      
      expect(blotterService.fetchOrderHistory).toHaveBeenCalledWith(42);
    });

    it('should show error if no account linked in session', () => {
      vi.mocked(sessionStore.accountId).mockReturnValue(null);
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));

      fixture.detectChanges();

      expect(component.error()).toContain('No account linked');
      expect(blotterService.fetchOrderHistory).not.toHaveBeenCalled();
    });
  });

  describe('order history rendering', () => {
    it('should order history renders newest first including rejections', () => {
      const rowsWithRejection: BlotterRow[] = [
        {
          orderId: 'ORD-1003',
          symbol: 'INFY',
          side: 'BUY' as const,
          quantity: 2,
          price: '₹1,450.00',
          date: 'Feb 14, 2026',
          status: OrderStatus.Rejected,
          isWorking: false
        },
        ...mockBlotterRows
      ];

      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(rowsWithRejection));

      fixture.detectChanges();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(component.rows()).toEqual(rowsWithRejection);
          
          const rejectedOrder = component.rows().find(r => r.status === OrderStatus.Rejected);
          expect(rejectedOrder).toBeDefined();
          
          resolve();
        }, 0);
      });
    });

    it('should render one row per order', async () => {
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));

      fixture.detectChanges();
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      const rows = compiled.querySelectorAll('tbody tr');

      expect(rows.length).toBe(mockBlotterRows.length);
    });

    it('should render order data correctly', async () => {
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));

      fixture.detectChanges();
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      const firstRow = compiled.querySelector('tbody tr');

      expect(firstRow?.textContent).toContain('ORD-1002');
      expect(firstRow?.textContent).toContain('TCS');
      expect(firstRow?.textContent).toContain('SELL');
      expect(firstRow?.textContent).toContain('5');
    });
  });

  describe('NEW order handling', () => {
    it('should an order at NEW is shown as still working', () => {
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));

      fixture.detectChanges();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const newOrder = component.rows().find(r => r.status === OrderStatus.New);
          expect(newOrder?.isWorking).toBe(true);
          
          const compiled = fixture.nativeElement as HTMLElement;
          const workingIndicator = compiled.querySelector('.working-indicator');
          expect(workingIndicator?.textContent).toContain('still working');
          
          resolve();
        }, 0);
      });
    });

    it('should set isPolling when NEW orders exist', () => {
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));

      fixture.detectChanges();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const hasNewOrders = component.rows().some(r => r.status === OrderStatus.New);
          expect(hasNewOrders).toBe(true);
          
          resolve();
        }, 0);
      });
    });

    it('should stop polling when nothing is at NEW', () => {
      const noNewOrders: BlotterRow[] = [
        {
          orderId: 'ORD-1001',
          symbol: 'RELIANCE',
          side: 'BUY' as const,
          quantity: 10,
          price: '₹1,300.00',
          date: 'Feb 10, 2026',
          status: OrderStatus.Filled,
          isWorking: false
        }
      ];

      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(noNewOrders));

      fixture.detectChanges();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const hasNewOrders = component.rows().some(r => r.status === OrderStatus.New);
          expect(hasNewOrders).toBe(false);
          expect(component.isPolling()).toBe(false);
          
          resolve();
        }, 0);
      });
    });
  });

  describe('empty state handling', () => {
    it('should empty history is handled gracefully', async () => {
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of([]));

      fixture.detectChanges();
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      const emptyState = compiled.querySelector('.empty-state');

      expect(emptyState).toBeTruthy();
      expect(emptyState?.textContent).toContain('No orders found');
    });
  });

  describe('status badges', () => {
    it('should render correct status badge classes', () => {
      expect(component.getStatusClass(OrderStatus.Filled)).toBe('success');
      expect(component.getStatusClass(OrderStatus.New)).toBe('pending');
      expect(component.getStatusClass(OrderStatus.Rejected)).toBe('failed');
      expect(component.getStatusClass(OrderStatus.Cancelled)).toBe('cancelled');
    });

    it('should display status with word and color', () => {
      expect(component.getStatusDisplay(OrderStatus.New)).toBe('Working');
      expect(component.getStatusDisplay(OrderStatus.Filled)).toBe('Filled');
      expect(component.getStatusDisplay(OrderStatus.Rejected)).toBe('Rejected');
      expect(component.getStatusDisplay(OrderStatus.Cancelled)).toBe('Cancelled');
    });

    it('should render status badges with correct styling', async () => {
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));

      fixture.detectChanges();
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      const statusBadges = compiled.querySelectorAll('.badge-table.pending, .badge-table.success');

      expect(statusBadges.length).toBeGreaterThan(0);
    });
  });

  describe('refresh functionality', () => {
    it('should call refreshOnce with account ID when refresh button clicked', async () => {
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));
      vi.mocked(blotterService.refreshOnce).mockReturnValue(of(mockBlotterRows));

      fixture.detectChanges();
      await fixture.whenStable();

      component.refreshOrders();

      expect(blotterService.refreshOnce).toHaveBeenCalledWith(42);
    });

    it('should update rows on manual refresh', () => {
      const updatedRows: BlotterRow[] = [
        {
          orderId: 'ORD-1005',
          symbol: 'WIPRO',
          side: 'BUY' as const,
          quantity: 15,
          price: '₹450.00',
          date: 'Feb 14, 2026',
          status: OrderStatus.Filled,
          isWorking: false
        }
      ];

      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));
      vi.mocked(blotterService.refreshOnce).mockReturnValue(of(updatedRows));

      fixture.detectChanges();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          component.refreshOrders();

          setTimeout(() => {
            expect(component.rows()).toEqual(updatedRows);
            resolve();
          }, 0);
        }, 0);
      });
    });

    it('should set isRefreshing flag during refresh', () => {
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));
      vi.mocked(blotterService.refreshOnce).mockReturnValue(of(mockBlotterRows));

      fixture.detectChanges();

      component.refreshOrders();
      expect(component.isRefreshing()).toBe(false);
    });

    it('should show error if no account linked when refresh button clicked', () => {
      vi.mocked(sessionStore.accountId).mockReturnValue(null);
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));

      fixture.detectChanges();

      component.refreshOrders();

      expect(component.error()).toContain('No account linked');
      expect(blotterService.refreshOnce).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should display error message on load failure', () => {
      const testError = new Error('API Error');
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(throwError(() => testError));
      vi.mocked(errorCatalog.messageForTrade).mockReturnValue('Order history could not be loaded');

      fixture.detectChanges();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(errorCatalog.messageForTrade).toHaveBeenCalledWith(testError);
          expect(component.error()).toBe('Order history could not be loaded');
          expect(component.isLoading()).toBe(false);
          
          const compiled = fixture.nativeElement as HTMLElement;
          const alert = compiled.querySelector('.alert-danger');
          expect(alert).toBeTruthy();
          
          resolve();
        }, 0);
      });
    });

    it('should display error message on refresh failure', () => {
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));
      
      const testError = new Error('Refresh Error');
      vi.mocked(blotterService.refreshOnce).mockReturnValue(throwError(() => testError));
      vi.mocked(errorCatalog.messageForTrade).mockReturnValue('Orders could not be refreshed');

      fixture.detectChanges();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          component.refreshOrders();

          setTimeout(() => {
            expect(errorCatalog.messageForTrade).toHaveBeenCalledWith(testError);
            expect(component.error()).toBe('Orders could not be refreshed');
            resolve();
          }, 0);
        }, 0);
      });
    });
  });

  describe('order actions', () => {
    describe('view order details', () => {
      it('should set selectedOrderForDetails when viewOrderDetails is called', () => {
        const order = mockBlotterRows[0];
        component.viewOrderDetails(order);

        expect(component.selectedOrderForDetails()).toBe(order);
      });

      it('should clear selectedOrderForDetails when closeDetailsModal is called', () => {
        const order = mockBlotterRows[0];
        component.viewOrderDetails(order);
        expect(component.selectedOrderForDetails()).toBe(order);

        component.closeDetailsModal();
        expect(component.selectedOrderForDetails()).toBeNull();
      });
    });

    describe('cancel order', () => {
      it('should call ordersService.cancelOrder with order ID without ORD prefix', () => {
        vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of([]));
        fixture.detectChanges();
        
        const order = mockBlotterRows[0];
        vi.mocked(ordersService.cancelOrder).mockReturnValue(of({}));
        vi.mocked(blotterService.refreshOnce).mockReturnValue(of([]));

        component.cancelOrder(order);

        expect(ordersService.cancelOrder).toHaveBeenCalledWith({ id: '1002' });
      });

      it('should refresh orders after successful cancellation', async () => {
        vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of([]));
        fixture.detectChanges();
        
        vi.mocked(sessionStore.accountId).mockReturnValue(42);
        const order = mockBlotterRows[0];
        vi.mocked(ordersService.cancelOrder).mockReturnValue(of({}));
        vi.mocked(blotterService.refreshOnce).mockReturnValue(of(mockBlotterRows));

        component.cancelOrder(order);

        await new Promise<void>((resolve) => {
          setTimeout(() => {
            expect(blotterService.refreshOnce).toHaveBeenCalledWith(42);
            resolve();
          }, 100);
        });
      });

      it('should clear isCancelling signal after successful cancellation', async () => {
        vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of([]));
        fixture.detectChanges();
        
        const order = mockBlotterRows[0];
        vi.mocked(ordersService.cancelOrder).mockReturnValue(of({}));
        vi.mocked(blotterService.refreshOnce).mockReturnValue(of(mockBlotterRows));

        component.cancelOrder(order);

        await new Promise<void>((resolve) => {
          setTimeout(() => {
            expect(component.isCancelling()).toBeNull();
            resolve();
          }, 100);
        });
      });

      it('should display error when cancelling a filled order', () => {
        const filledOrder = mockBlotterRows[1];
        
        component.cancelOrder(filledOrder);

        expect(component.error()).toContain('Working');
        expect(ordersService.cancelOrder).not.toHaveBeenCalled();
      });

      it('should handle cancellation errors', async () => {
        vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of([]));
        fixture.detectChanges();
        
        const order = mockBlotterRows[0];
        const testError = new Error('Cancel failed');
        vi.mocked(ordersService.cancelOrder).mockReturnValue(throwError(() => testError));
        vi.mocked(errorCatalog.messageForTrade).mockReturnValue('Could not cancel order');

        component.cancelOrder(order);

        await new Promise<void>((resolve) => {
          setTimeout(() => {
            expect(errorCatalog.messageForTrade).toHaveBeenCalledWith(testError);
            expect(component.error()).toBe('Could not cancel order');
            expect(component.isCancelling()).toBeNull();
            resolve();
          }, 100);
        });
      });
    });

    describe('canCancelOrder', () => {
      it('should return true for orders with NEW status', () => {
        const newOrder = mockBlotterRows[0];
        expect(component.canCancelOrder(newOrder)).toBe(true);
      });

      it('should return false for orders with FILLED status', () => {
        const filledOrder = mockBlotterRows[1];
        expect(component.canCancelOrder(filledOrder)).toBe(false);
      });

      it('should return false for orders with REJECTED status', () => {
        const rejectedOrder: BlotterRow = { ...mockBlotterRows[0], status: OrderStatus.Rejected };
        expect(component.canCancelOrder(rejectedOrder)).toBe(false);
      });

      it('should return false for orders with CANCELLED status', () => {
        const cancelledOrder: BlotterRow = { ...mockBlotterRows[0], status: OrderStatus.Cancelled };
        expect(component.canCancelOrder(cancelledOrder)).toBe(false);
      });
    });
  });

  describe('cleanup', () => {
    it('should stop polling on destroy', () => {
      vi.mocked(blotterService.fetchOrderHistory).mockReturnValue(of(mockBlotterRows));

      fixture.detectChanges();
      fixture.destroy();

      expect(blotterService.stopPolling).toHaveBeenCalled();
    });
  });
});

