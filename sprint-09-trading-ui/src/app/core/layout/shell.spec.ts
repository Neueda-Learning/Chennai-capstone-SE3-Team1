import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Shell } from './shell';

describe('Shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [provideRouter([])]
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(Shell);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the three navigation links', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const links = Array.from(compiled.querySelectorAll('.sidebar-menu-link')).map((el) =>
      el.textContent?.trim()
    );
    expect(links).toEqual(['Dashboard', 'Order Ticket', 'Blotter']);
  });

  it('should open the mobile sidebar on toggle', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const toggleBtn = compiled.querySelector<HTMLButtonElement>('.sidebar-toggle-btn');
    toggleBtn?.click();
    fixture.detectChanges();

    expect(compiled.querySelector('.sidebar-wrapper')?.classList.contains('show')).toBe(true);
  });
});
