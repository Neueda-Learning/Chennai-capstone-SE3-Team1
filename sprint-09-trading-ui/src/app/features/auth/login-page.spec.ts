import { TestBed } from '@angular/core/testing';
import { LoginPage } from './login-page';

describe('LoginPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginPage]
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(LoginPage);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should mask the password by default and reveal it on toggle', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const passwordInput = compiled.querySelector<HTMLInputElement>('#password');
    expect(passwordInput?.type).toBe('password');

    compiled.querySelector<HTMLButtonElement>('.password-toggle-btn')?.click();
    fixture.detectChanges();

    expect(passwordInput?.type).toBe('text');
  });

  it('should mark the form as validated on submit without navigating away', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const form = compiled.querySelector('form');
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect(form?.classList.contains('was-validated')).toBe(true);
  });
});
