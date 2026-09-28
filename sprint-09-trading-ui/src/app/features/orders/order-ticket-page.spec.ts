import { TestBed } from '@angular/core/testing';
import { OrderTicketPage } from './order-ticket-page';

describe('OrderTicketPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderTicketPage]
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(OrderTicketPage);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should default to Buy and switch to Sell on click', async () => {
    const fixture = TestBed.createComponent(OrderTicketPage);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const [buyBtn, sellBtn] = Array.from(compiled.querySelectorAll<HTMLButtonElement>('.btn-custom'));
    expect(buyBtn.classList.contains('btn-custom-primary')).toBe(true);

    sellBtn.click();
    fixture.detectChanges();

    expect(buyBtn.classList.contains('btn-custom-outline-primary')).toBe(true);
    expect(sellBtn.classList.contains('btn-custom-danger')).toBe(true);
  });

  it('should disable the price field for a market order and enable it for a limit order', async () => {
    const fixture = TestBed.createComponent(OrderTicketPage);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const priceInput = compiled.querySelector<HTMLInputElement>('#price');
    expect(priceInput?.disabled).toBe(true);

    compiled.querySelectorAll<HTMLInputElement>('input[name="orderType"]')[1].dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(priceInput?.disabled).toBe(false);
  });
});
