import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ErrorCatalog } from '../../core/errors/error-catalog';
import { AuthService, RegisterRequest } from '../../generated/auth-client';

@Component({
  selector: 'tui-register-page',
  imports: [RouterLink],
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

    this.error.set(null);
    this.submitting.set(true);

    const request: RegisterRequest = { username, password, email };
    this.auth.register({ registerRequest: request }).subscribe({
      next: () => this.onRegistered(),
      error: (failure: HttpErrorResponse) => this.onRegistrationFailed(failure)
    });
  }

  /** Registration returns no tokens by design; hand the visitor to sign-in. */
  private onRegistered(): void {
    void this.router.navigate(['/login'], { queryParams: { registered: 'true' } });
  }

  private onRegistrationFailed(failure: HttpErrorResponse): void {
    this.submitting.set(false);
    this.error.set(this.errors.messageForRegister(failure));
  }
}