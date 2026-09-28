import { TitleCasePipe } from '@angular/common';
import { Component } from '@angular/core';

interface BlotterRow {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: string;
  date: string;
  status: 'FILLED' | 'WORKING' | 'REJECTED';
}

const MOCK_ROWS: BlotterRow[] = [
  { orderId: 'ORD-9982', symbol: 'RELIANCE', side: 'BUY', quantity: 10, price: '₹1,300.00', date: 'Feb 14, 2026', status: 'FILLED' },
  { orderId: 'ORD-9981', symbol: 'INFY', side: 'SELL', quantity: 5, price: '₹1,450.00', date: 'Feb 13, 2026', status: 'WORKING' },
  { orderId: 'ORD-9980', symbol: 'TCS', side: 'BUY', quantity: 2, price: '₹3,400.00', date: 'Feb 12, 2026', status: 'FILLED' },
  { orderId: 'ORD-9979', symbol: 'TATASTEEL', side: 'SELL', quantity: 20, price: '₹170.00', date: 'Feb 11, 2026', status: 'REJECTED' },
  { orderId: 'ORD-9978', symbol: 'RELIANCE', side: 'SELL', quantity: 8, price: '₹1,310.00', date: 'Feb 10, 2026', status: 'FILLED' }
];

@Component({
  selector: 'tui-blotter-page',
  imports: [TitleCasePipe],
  templateUrl: './blotter-page.html',
  styleUrl: './blotter-page.css'
})
export class BlotterPage {
  protected readonly rows = MOCK_ROWS;
}
