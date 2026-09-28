import { TestBed } from '@angular/core/testing';
import { BlotterPage } from './blotter-page';

describe('BlotterPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BlotterPage]
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(BlotterPage);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render one row per mock order', async () => {
    const fixture = TestBed.createComponent(BlotterPage);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const rows = compiled.querySelectorAll('tbody tr');
    expect(rows.length).toBe(5);
  });
});
