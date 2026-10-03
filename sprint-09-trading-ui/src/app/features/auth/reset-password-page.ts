import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ErrorCatalog } from '../../core/errors/error-catalog';
import {
  passwordPolicyPassed,
  passwordRequirements as rulesForPassword
} from '../../core/auth/password-rules';
import {
  ResetPasswordRequest,
  VerificationService
} from '../../generated/auth-client';
import { ThemeToggle } from '../../core/theme/theme-toggle';

@Component({
  selector: 'tui-reset-password-page',
  imports: [RouterLink, ThemeToggle],
  templateUrl: './reset-password-page.html',
  styleUrl: './reset-password-page.css'
})
export class ResetPasswordPage {
  private readonly verification = inject(VerificationService);
  private readonly errors = inject(ErrorCatalog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly passwordVisible = signal(false);
  protected readonly confirmPasswordVisible = signal(false);
  protected readonly submitted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly otp = signal('');
  protected readonly password = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly error = signal<string | null>(null);

  /**
   * Carried over from the forgot-password page. The code is what proves the
   * reset; the address only says which account the code is checked against.
   */
  protected readonly email = signal(
    this.route.snapshot.queryParamMap.get('email')?.trim() ?? ''
  );

  protected readonly otpComplete = computed(() => /^\d{6}$/.test(this.otp().trim()));

  /** The same rules the register screen shows, and the same ones the service enforces. */
  protected readonly showPasswordHelp = computed(() => this.password() !== '');
  protected readonly passwordRequirements = computed(() =>
    rulesForPassword(this.password())
  );
  protected readonly passwordPolicyPassed = computed(() =>
    passwordPolicyPassed(this.password())
  );
  protected readonly confirmTouched = computed(() => this.confirmPassword() !== '');
  protected readonly passwordsMatch = computed(
    () => this.password() !== '' && this.password() === this.confirmPassword()
  );

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  protected toggleConfirmPasswordVisibility(): void {
    this.confirmPasswordVisible.update((visible) => !visible);
  }

  protected onOtpInput(event: Event): void {
    this.otp.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected onPasswordInput(event: Event): void {
    this.password.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected onConfirmPasswordInput(event: Event): void {
    this.confirmPassword.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);

    const email = this.email();
    const otp = this.otp().trim();
    const newPassword = this.password();
    if (email === '' || !this.otpComplete() || newPassword === '') {
      return;
    }

    if (newPassword !== this.confirmPassword()) {
      this.error.set('The two password fields do not match.');
      return;
    }

    if (!this.passwordPolicyPassed()) {
      return;
    }

    this.error.set(null);
    this.submitting.set(true);

    const request: ResetPasswordRequest = { email, otp, newPassword };
    this.verification.resetPassword({ resetPasswordRequest: request }).subscribe({
      next: () => void this.router.navigate(['/login'], { queryParams: { reset: 'true' } }),
      error: (failure: HttpErrorResponse) => {
        this.submitting.set(false);
        this.error.set(this.errors.messageForReset(failure));
      }
    });
  }
}
