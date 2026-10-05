import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { SessionStore } from '../../core/auth/session.store';
import { ErrorCatalog } from '../../core/errors/error-catalog';
import { OrdersService } from '../../generated/trade-client/api/orders.service';
import { BlotterPage } from './blotter-page';
import { BlotterRow, BlotterService } from './blotter.service';

const row = (overrides: Partial<BlotterRow>): BlotterRow => ({
  orderId: 'ORD-1',
  symbol: 'HDFCBANK',
  side: 'BUY',
  quantity: 1,
  price: '₹735.74',
  date: 'Oct 3, 2026',
  status: 'NEW',
  isWorking: true,
  ...overrides
});

/**
 * Orders go in at the market with a protective limit a little off the price, so the limit is not
 * the price a trade happened at. The blotter must lead with what a filled order executed at.
 */
describe('BlotterPage price column', () => {
  function render(rows: BlotterRow[]): HTMLElement {
    TestBed.configureTestingModule({
      imports: [BlotterPage],
      providers: [
        { provide: BlotterService, useValue: { fetchOrderHistory: () => of(rows), stopPolling: () => undefined } },
        { provide: SessionStore, useValue: { accountId: () => 4 } },
        { provide: ErrorCatalog, useValue: { forCode: () => 'x' } },
        { provide: OrdersService, useValue: {} }
      ]
    });
    const fixture = TestBed.createComponent(BlotterPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows what a filled order executed at, with the limit as a footnote', () => {
    const el = render([row({ status: 'FILLED', isWorking: false, executedPrice: '₹721.35' })]);

    expect(el.querySelector('[data-testid="executed-price"]')?.textContent).toBe('₹721.35');
    expect(el.querySelector('[data-testid="price-cell"]')?.textContent).toContain('limit ₹735.74');
    expect(el.querySelector('[data-testid="limit-price"]')).toBeNull();
  });

  it('labels the price of an order that has not filled as its limit', () => {
    const el = render([row({}), row({ orderId: 'ORD-2', status: 'CANCELLED', isWorking: false })]);

    const limits = Array.from(el.querySelectorAll('[data-testid="limit-price"]')).map((c) => c.textContent);
    const notes = Array.from(el.querySelectorAll('[data-testid="price-cell"] .price-note')).map((c) => c.textContent?.trim());
    expect(limits).toEqual(['₹735.74', '₹735.74']);
    expect(notes).toEqual(['limit', 'limit']);
    expect(el.querySelector('[data-testid="executed-price"]')).toBeNull();
  });
});
