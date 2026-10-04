import { Component, input } from '@angular/core';

/**
 * The picture slot for a person: their image when there is one, otherwise a neutral placeholder
 * showing their initials (or a generic silhouette when not even a name is known yet). No image
 * data exists for users today, so in practice this is always the placeholder.
 *
 * `imgClass` is the class the surrounding layout already uses for its picture
 * (`sidebar-profile-img`, `navbar-profile-img`), so the placeholder takes exactly its size.
 */
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
