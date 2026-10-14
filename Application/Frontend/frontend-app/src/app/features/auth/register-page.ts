import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ErrorCatalog } from '../../core/errors/error-catalog';
import {
  passwordPolicyPassed,
  passwordRequirements as rulesForPassword
} from '../../core/auth/password-rules';
import { AuthService, RegisterRequest } from '../../generated/auth-client';
import { ThemeToggle } from '../../core/theme/theme-toggle';

@Component({
  selector: 'tui-register-page',
  imports: [RouterLink, ThemeToggle],
  templateUrl: './register-page.html',
  styleUrl: './register-page.css'
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly errors = inject(ErrorCatalog);
  private readonly router = inject(Router);

  protected readonly passwordVisible = signal(false);
  protected readonly confirmPasswordVisible = signal(false);
  protected readonly submitted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly username = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly error = signal<string | null>(null);

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

  protected onUsernameInput(event: Event): void {
    this.username.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected onEmailInput(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
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

    const username = this.username().trim();
    const email = this.email().trim();
    const password = this.password();
    if (username === '' || email === '' || password === '' || this.confirmPassword() === '') {
      return;
    }

    if (password !== this.confirmPassword()) {
      this.error.set('The two password fields do not match.');
      return;
    }

    if (!this.passwordPolicyPassed()) {
      return;
    }

    this.error.set(null);
    this.submitting.set(true);

    const request: RegisterRequest = { username, password, email };
    this.auth.register({ registerRequest: request }).subscribe({
      next: () => this.onRegistered(),
      error: (failure: HttpErrorResponse) => this.onRegistrationFailed(failure)
    });
  }

  private onRegistered(): void {
    void this.router.navigate(['/verify-otp'], {
      queryParams: { email: this.email().trim() }
    });
  }

  private onRegistrationFailed(failure: HttpErrorResponse): void {
    this.submitting.set(false);
    this.error.set(this.errors.messageForRegister(failure));
  }
}