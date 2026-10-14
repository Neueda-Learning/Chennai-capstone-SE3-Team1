import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ErrorCatalog } from '../../core/errors/error-catalog';
import { VerificationService } from '../../generated/auth-client';
import { ThemeToggle } from '../../core/theme/theme-toggle';

@Component({
  selector: 'tui-forgot-password-page',
  imports: [RouterLink, ThemeToggle],
  templateUrl: './forgot-password-page.html',
  styleUrl: './forgot-password-page.css'
})
export class ForgotPasswordPage {
  private readonly verification = inject(VerificationService);
  private readonly errors = inject(ErrorCatalog);
  private readonly router = inject(Router);

  protected readonly submitted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly email = signal('');
  protected readonly error = signal<string | null>(null);

  protected onEmailInput(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);

    const email = this.email().trim();
    if (email === '') {
      return;
    }

    this.error.set(null);
    this.submitting.set(true);

    this.verification.forgotPassword({ emailRequest: { email } }).subscribe({
      next: () => void this.router.navigate(['/reset-password'], { queryParams: { email } }),
      error: (failure: HttpErrorResponse) => {
        this.submitting.set(false);
        this.error.set(this.errors.messageForReset(failure));
      }
    });
  }
}
