import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { ErrorResponse } from '../../generated/trade-client';

/**
 * PLACEHOLDER — owned by Haripriya (sprint stories 7 and 8).
 *
 * The order ticket needs to turn a failed submission into a sentence a
 * trader can act on. Turning a backend error code into that sentence is
 * Haripriya's story, so this is only the seam: one method, called by the
 * ticket, replaced wholesale when the error code mapping service lands.
 *
 * What matters for whoever replaces it: branch on `errorCode`, never on the
 * HTTP status and never on `message`. 404 and 409 each carry two codes
 * (`generated/trade-client/model/errorResponse.ts`), so a status-keyed map
 * gets half of them wrong.
 */
@Injectable({ providedIn: 'root' })
export class OrderErrorMessages {
  /**
   * @param failure the rejected `HttpErrorResponse` from the Trade REST API.
   * @returns a message safe to show a user.
   */
  forOrderFailure(failure: unknown): string {
    const body = (failure as HttpErrorResponse | null)?.error as ErrorResponse | undefined;

    // The contract already promises `message` is written for a human and
    // carries no stack trace, SQL or internal identifier, so passing it
    // through is honest until the real map exists.
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
