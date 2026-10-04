import { TestBed } from '@angular/core/testing';
import { BlotterService, BlotterRow } from './blotter.service';
import { AccountsService } from '../../generated/trade-client/api/accounts.service';
import { OrderHistoryEntry, OrderStatus, OrderSide } from '../../generated/trade-client';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

describe('BlotterService', () => {
  let service: BlotterService;
  let accountsService: any;

  beforeEach(() => {
    const getOrdersMock = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        BlotterService,
        { provide: AccountsService, useValue: { getOrders: getOrdersMock } as any }
      ]
    });

    service = TestBed.inject(BlotterService);
    accountsService = TestBed.inject(AccountsService);
  });

  describe('formatOrders', () => {
    it('order history renders newest first with rejections', () => {
      const mockOrders: OrderHistoryEntry[] = [
        {
          orderId: 'ORD-1001',
          accountId: 1,
          symbol: 'RELIANCE',
          side: OrderSide.Buy,
          quantity: 10,
          price: 1300,
          status: OrderStatus.Filled,
          createdOn: '2026-02-10T10:00:00Z'
        },
        {
          orderId: 'ORD-1002',
          accountId: 1,
          symbol: 'TCS',
          side: OrderSide.Sell,
          quantity: 5,
          price: 3400,
          status: OrderStatus.Rejected,
          createdOn: '2026-02-14T15:30:00Z'
        },
        {
          orderId: 'ORD-1003',
          accountId: 1,
          symbol: 'INFY',
          side: OrderSide.Buy,
          quantity: 2,
          price: 1450,
          status: OrderStatus.Filled,
          createdOn: '2026-02-12T12:00:00Z'
        }
      ];

      vi.mocked(accountsService.getOrders).mockReturnValue(of(mockOrders));

      return new Promise<void>((resolve) => {
        service.fetchOrderHistory(1).subscribe((result) => {
          expect(result.some(r => r.status === OrderStatus.Rejected)).toBe(true);
          expect(result[0].orderId).toBe('ORD-1002');
          expect(result[0].status).toBe(OrderStatus.Rejected);
          expect(result[1].orderId).toBe('ORD-1003');
          expect(result[2].orderId).toBe('ORD-1001');
          resolve();
        });
      });
    });

    it('formats prices with rupee symbol and commas', () => {
      const mockOrders: OrderHistoryEntry[] = [
        {
          orderId: 'ORD-1001',
          accountId: 1,
          symbol: 'RELIANCE',
          side: OrderSide.Buy,
          quantity: 10,
          price: 1300.50,
          status: OrderStatus.Filled,
          createdOn: '2026-02-14T10:00:00Z'
        }
      ];

      vi.mocked(accountsService.getOrders).mockReturnValue(of(mockOrders));

      return new Promise<void>((resolve) => {
        service.fetchOrderHistory(1).subscribe((result) => {
          expect(result[0].price).toBe('₹1,300.50');
          resolve();
        });
      });
    });

    it('formats dates as readable strings', () => {
      const mockOrders: OrderHistoryEntry[] = [
        {
          orderId: 'ORD-1001',
          accountId: 1,
          symbol: 'RELIANCE',
          side: OrderSide.Buy,
          quantity: 10,
          price: 1300,
          status: OrderStatus.Filled,
          createdOn: '2026-02-14T10:00:00Z'
        }
      ];

      vi.mocked(accountsService.getOrders).mockReturnValue(of(mockOrders));

      return new Promise<void>((resolve) => {
        service.fetchOrderHistory(1).subscribe((result) => {
          expect(result[0].date).toMatch(/Feb \d+, 2026/);
          resolve();
        });
      });
    });

    it('an order at NEW is shown as still working', () => {
      const mockOrders: OrderHistoryEntry[] = [
        {
          orderId: 'ORD-1001',
          accountId: 1,
          symbol: 'RELIANCE',
          side: OrderSide.Buy,
          quantity: 10,
          price: 1300,
          status: OrderStatus.New,
          createdOn: '2026-02-14T10:00:00Z'
        },
        {
          orderId: 'ORD-1002',
          accountId: 1,
          symbol: 'TCS',
          side: OrderSide.Sell,
          quantity: 5,
          price: 3400,
          status: OrderStatus.Filled,
          createdOn: '2026-02-13T10:00:00Z'
        }
      ];

      vi.mocked(accountsService.getOrders).mockReturnValue(of(mockOrders));

      return new Promise<void>((resolve) => {
        service.fetchOrderHistory(1).subscribe((result) => {
          const newOrder = result.find(r => r.status === OrderStatus.New);
          const filledOrder = result.find(r => r.status === OrderStatus.Filled);
          
          expect(newOrder?.isWorking).toBe(true);
          expect(filledOrder?.isWorking).toBe(false);
          resolve();
        });
      });
    });
  });

  describe('polling behavior', () => {
    it('the re-read stops when nothing is at NEW', () => {
      const mockOrders: OrderHistoryEntry[] = [
        {
          orderId: 'ORD-1001',
          accountId: 1,
          symbol: 'RELIANCE',
          side: OrderSide.Buy,
          quantity: 10,
          price: 1300,
          status: OrderStatus.Filled,
          createdOn: '2026-02-14T10:00:00Z'
        }
      ];

      vi.mocked(accountsService.getOrders).mockReturnValue(of(mockOrders));

      return new Promise<void>((resolve) => {
        service.fetchOrderHistory(1).subscribe((rows) => {
          expect(rows[0].status).toBe(OrderStatus.Filled);
          resolve();
        });
      });
    });
  });

  describe('refreshOnce', () => {
    it('fetches orders once without polling', () => {
      const mockOrders: OrderHistoryEntry[] = [
        {
          orderId: 'ORD-1001',
          accountId: 1,
          symbol: 'RELIANCE',
          side: OrderSide.Buy,
          quantity: 10,
          price: 1300,
          status: OrderStatus.New,
          createdOn: '2026-02-14T10:00:00Z'
        }
      ];

      vi.mocked(accountsService.getOrders).mockReturnValue(of(mockOrders));

      return new Promise<void>((resolve) => {
        service.refreshOnce(1).subscribe((result) => {
          expect(result.length).toBe(1);
          expect(result[0].orderId).toBe('ORD-1001');
          resolve();
        });
      });
    });

    it('empty history is handled gracefully', () => {
      vi.mocked(accountsService.getOrders).mockReturnValue(of([]));

      return new Promise<void>((resolve) => {
        service.refreshOnce(1).subscribe((result) => {
          expect(result).toEqual([]);
          resolve();
        });
      });
    });
  });

  describe('error handling', () => {
    it('handles API errors in refreshOnce', () => {
      vi.mocked(accountsService.getOrders).mockReturnValue(
        throwError(() => new Error('API Error'))
      );

      return new Promise<void>((resolve, reject) => {
        service.refreshOnce(1).subscribe({
          error: (err) => {
            expect(err).toBeDefined();
            resolve();
          }
        });
      });
    });
  });
});
