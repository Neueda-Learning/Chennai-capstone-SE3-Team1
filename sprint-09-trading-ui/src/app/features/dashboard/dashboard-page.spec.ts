import { TestBed } from '@angular/core/testing';
import { DashboardPage } from './dashboard-page';

describe('DashboardPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage]
    }).compileComponents();
  });

  it('should create and render its charts', async () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Dashboard');
  });

  it('should render its key summary cards', async () => {
    const fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const titles = Array.from(compiled.querySelectorAll('.card-title')).map((el) => el.textContent?.trim());
    expect(titles).toEqual(
      expect.arrayContaining(['Order Flow', 'Recent Orders', 'Order Summary', 'Portfolio Allocation'])
    );
  });
});
