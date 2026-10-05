import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { ErrorResponse } from '../../generated/trade-client';

@Injectable({ providedIn: 'root' })
export class OrderErrorMessages {
  forOrderFailure(failure: unknown): string {
    const body = (failure as HttpErrorResponse | null)?.error as ErrorResponse | undefined;

    if (body?.message) {
      return body.message;
    }

    const status = (failure as HttpErrorResponse | null)?.status;
    if (status === 0) {
      return 'Could not reach the trading service. Check your connection and try again.';
    }

    return 'The order could not be placed. Please try again.';
  }
}
