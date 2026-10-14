import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ErrorCatalog } from '../../core/errors/error-catalog';
import { VerificationService, VerifyOtpRequest } from '../../generated/auth-client';
import { ThemeToggle } from '../../core/theme/theme-toggle';

@Component({
  selector: 'tui-verify-otp-page',
  imports: [RouterLink, ThemeToggle],
  templateUrl: './verify-otp-page.html',
  styleUrl: './verify-otp-page.css'
})
export class VerifyOtpPage {
  private readonly verification = inject(VerificationService);
  private readonly errors = inject(ErrorCatalog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly submitted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly resending = signal(false);
  protected readonly otp = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly email = signal(
    this.route.snapshot.queryParamMap.get('email')?.trim() ?? ''
  );

  protected readonly otpComplete = computed(() => /^\d{6}$/.test(this.otp().trim()));

  protected onEmailInput(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected onOtpInput(event: Event): void {
    this.otp.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);

    const email = this.email().trim();
    const otp = this.otp().trim();
    if (email === '' || !this.otpComplete()) {
      return;
    }

    this.error.set(null);
    this.submitting.set(true);

    const request: VerifyOtpRequest = { email, otp };
    this.verification.verifyOtp({ verifyOtpRequest: request }).subscribe({
      next: () => this.onVerified(),
      error: (failure: HttpErrorResponse) => this.onVerifyFailed(failure)
    });
  }

  protected onResend(event: Event): void {
    event.preventDefault();

    const email = this.email().trim();
    if (email === '' || this.resending()) {
      return;
    }

    this.resending.set(true);
    this.error.set(null);

    this.verification.resendOtp({ emailRequest: { email } }).subscribe({
      next: () => {
        this.resending.set(false);
        this.notice.set('If that account is still waiting to be verified, a new code is on its way.');
      },
      error: (failure: HttpErrorResponse) => {
        this.resending.set(false);
        this.notice.set(null);
        this.error.set(this.errors.messageForVerify(failure));
      }
    });
  }

  private onVerified(): void {
    void this.router.navigate(['/login'], { queryParams: { verified: 'true' } });
  }

  private onVerifyFailed(failure: HttpErrorResponse): void {
    this.submitting.set(false);
    this.error.set(this.errors.messageForVerify(failure));
  }
}
