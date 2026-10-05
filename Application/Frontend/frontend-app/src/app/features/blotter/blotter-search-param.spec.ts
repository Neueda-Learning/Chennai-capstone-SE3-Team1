import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';

import { SessionStore } from '../../core/auth/session.store';
import { ErrorCatalog } from '../../core/errors/error-catalog';
import { OrdersService } from '../../generated/trade-client/api/orders.service';
import { BlotterPage } from './blotter-page';
import { BlotterRow, BlotterService } from './blotter.service';

const row = (orderId: string, symbol: string): BlotterRow => ({
  orderId,
  symbol,
  side: 'BUY',
  quantity: 1,
  price: '₹1.00',
  date: 'Oct 2, 2026',
  status: 'FILLED',
  isWorking: false
});

describe('BlotterPage ?q= filter', () => {
  it('filters to the order named in the URL, and follows later changes of it', () => {
    const params = new BehaviorSubject(convertToParamMap({ q: 'ORD-bbb' }));
    TestBed.configureTestingModule({
      imports: [BlotterPage],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: params } },
        { provide: BlotterService, useValue: { fetchOrderHistory: () => of([row('ORD-aaa', 'TCS'), row('ORD-bbb', 'INFY')]), stopPolling: () => undefined } },
        { provide: SessionStore, useValue: { accountId: () => 4 } },
        { provide: ErrorCatalog, useValue: { forCode: () => 'x' } },
        { provide: OrdersService, useValue: {} }
      ]
    });
    const fixture = TestBed.createComponent(BlotterPage);
    fixture.detectChanges();
    const page = fixture.componentInstance;

    expect(page.searchText()).toBe('ORD-bbb');
    expect(page.filteredRows().map((r) => r.orderId)).toEqual(['ORD-bbb']);

    params.next(convertToParamMap({ q: 'ORD-aaa' }));
    expect(page.filteredRows().map((r) => r.orderId)).toEqual(['ORD-aaa']);

    params.next(convertToParamMap({}));
    expect(page.filteredRows()).toHaveLength(1);
  });
});
