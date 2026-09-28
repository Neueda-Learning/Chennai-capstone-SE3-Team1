import { Component, signal } from '@angular/core';

type OrderSide = 'BUY' | 'SELL';
type OrderType = 'MARKET' | 'LIMIT';

@Component({
  selector: 'tui-order-ticket-page',
  templateUrl: './order-ticket-page.html',
  styleUrl: './order-ticket-page.css'
})
export class OrderTicketPage {
  protected readonly side = signal<OrderSide>('BUY');
  protected readonly orderType = signal<OrderType>('MARKET');

  protected selectSide(side: OrderSide): void {
    this.side.set(side);
  }

  protected selectOrderType(orderType: OrderType): void {
    this.orderType.set(orderType);
  }

  protected onSubmit(event: Event): void {
    // UI-only: this ticket does not place a real order. Wiring to the
    // Trade API is a later story.
    event.preventDefault();
  }
}
