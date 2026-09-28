import { Component, signal } from '@angular/core';

@Component({
  selector: 'tui-login-page',
  templateUrl: './login-page.html',
  styleUrl: './login-page.css'
})
export class LoginPage {
  protected readonly passwordVisible = signal(false);
  protected readonly submitted = signal(false);

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  protected onSubmit(event: Event): void {
    // UI-only: this screen does not authenticate. Wiring to the auth
    // service is a later story; this just shows Bootstrap's validation state.
    event.preventDefault();
    this.submitted.set(true);
  }
}
