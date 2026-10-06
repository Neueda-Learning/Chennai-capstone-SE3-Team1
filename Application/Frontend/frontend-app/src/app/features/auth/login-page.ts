import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ErrorCatalog } from '../../core/errors/error-catalog';
import { ReturnUrlStore } from '../../core/auth/return-url.store';
import { SessionStore } from '../../core/auth/session.store';
import { PreferencesService } from '../../core/services/preferences.service';
import { AuthService, LoginRequest, TokenResponse } from '../../generated/auth-client';
import { ThemeToggle } from '../../core/theme/theme-toggle';

@Component({
  selector: 'tui-login-page',
  imports: [RouterLink, ThemeToggle],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css'
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionStore);
  private readonly errors = inject(ErrorCatalog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly returnUrl = inject(ReturnUrlStore);
  private readonly preferences = inject(PreferencesService);

  protected readonly passwordVisible = signal(false);
  protected readonly submitted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);

  protected readonly registered = signal(
    this.route.snapshot.queryParamMap.get('registered') === 'true'
  );

  protected readonly verified = signal(
    this.route.snapshot.queryParamMap.get('verified') === 'true'
  );

  protected readonly reset = signal(
    this.route.snapshot.queryParamMap.get('reset') === 'true'
  );

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  protected onUsernameInput(event: Event): void {
    this.username.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected onPasswordInput(event: Event): void {
    this.password.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);

    const username = this.username();
    const password = this.password();
    if (username === '' || password === '') {
      return;
    }

    this.error.set(null);
    this.submitting.set(true);

    const credentials: LoginRequest = { username: username.trim(), password };
    this.auth.login({ loginRequest: credentials }).subscribe({
      next: (tokens) => this.onSignedIn(tokens),
      error: (failure: HttpErrorResponse) => this.onSignInFailed(failure)
    });
  }

  private onSignedIn(tokens: TokenResponse): void {
    this.session.signIn(tokens.accessToken, null, tokens.refreshToken);

    const destination = this.returnUrl.consume(
      this.route.snapshot.queryParamMap.get(ReturnUrlStore.param)
    );
    const accountId = this.session.accountId();
    if (accountId === null) {
      void this.router.navigateByUrl(destination);
      return;
    }
    this.preferences.applyDefaultAccount(accountId).subscribe(() => {
      void this.router.navigateByUrl(destination);
    });
  }

  private onSignInFailed(failure: HttpErrorResponse): void {
    this.submitting.set(false);
    this.error.set(this.errors.messageForSignIn(failure));
  }
}