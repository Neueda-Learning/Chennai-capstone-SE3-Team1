import { Component, input } from '@angular/core';

@Component({
  selector: 'tui-avatar',
  template: `
    @if (src(); as url) {
      <img [src]="url" alt="" [class]="imgClass()" data-testid="avatar-image" />
    } @else {
      <span [class]="'avatar-placeholder ' + imgClass()" aria-hidden="true" data-testid="avatar-placeholder">
        @if (initials()) {
          {{ initials() }}
        } @else {
          <i class="bi bi-person-fill"></i>
        }
      </span>
    }
  `
})
export class Avatar {
  readonly src = input<string | null>(null);
  readonly initials = input<string>('');
  readonly imgClass = input<string>('');
}
