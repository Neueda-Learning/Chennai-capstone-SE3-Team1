import { Component, inject } from '@angular/core';

import { NotificationStore, notificationStyle } from './notification.store';

@Component({
  selector: 'tui-toast-container',
  template: `
    <div class="toast-stack" aria-live="polite" aria-atomic="false">
      @for (toast of store.toasts(); track toast.id) {
        <div class="toast-item" [class]="'toast-item toast-' + style(toast.kind).tone" role="status" data-testid="toast">
          <div class="toast-icon"><i class="bi" [class]="'bi ' + style(toast.kind).icon"></i></div>
          <div class="toast-body">{{ toast.message }}</div>
          <button
            type="button"
            class="toast-close"
            aria-label="Dismiss notification"
            (click)="store.dismissToast(toast.id)"
          >
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      }
    </div>
  `
})
export class ToastContainer {
  protected readonly store = inject(NotificationStore);
  protected readonly style = notificationStyle;
}
