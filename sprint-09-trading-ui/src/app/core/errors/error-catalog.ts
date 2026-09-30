import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

/**
 * The error envelope the auth service's contract guarantees (see
 * `generated/auth-client/model/errorResponse.ts`).
 */
export interface ErrorEnvelope {
  errorCode?: string;
  message?: string;
}

/** Every `errorCode` the auth contract can return on sign-in. */
export const AUTH_ERROR_CODES = ['AUTH-401', 'AUTH-409', 'VAL-422'] as const;

/**
 * Sign-in failures to sentences. Haripriya extends this map for her broader
 * error-handling story; the sign-in page only ever renders a slice of it, and
 * the register flow (a later story) reads from the same place.
 *
 * The auth service deliberately returns the same vague `AUTH-401` for every
 * bad-credential case, so the message cannot say which field was wrong -
 * naming it would hand an attacker a username oracle.
 */
export const authErrorMessageByCode: Readonly<Record<string, string>> = {
  'AUTH-401': 'The username or password was not recognised. Check them and try again.',
  'AUTH-409': 'This account cannot be signed in to. Try again shortly.',
  'VAL-422': 'One of the sign-in fields is not valid. Check and try again.'
};

/**
 * Registration failures to sentences, from the same envelope. `AUTH-409`
 * means the username or the email is already taken; `VAL-422` that a field
 * failed validation. `AUTH-401` cannot happen on the public route, and is
 * mapped only so no path leaks a raw failure.
 */
export const registerErrorMessageByCode: Readonly<Record<string, string>> = {
  'AUTH-401': 'Registration could not be completed. Try again shortly.',
  'AUTH-409': 'That username or email is already registered. Sign in, or use a different one.',
  'VAL-422': 'One of the registration fields is not valid. Check the highlighted fields and try again.'
};

/**
 * Email-verification and password-reset failures to sentences. `AUTH-410` is the
 * service's single answer for every way a one-time code can fail, so the message
 * cannot promise which one it was. `VAL-422` on a reset means the new password
 * did not meet the policy.
 */
export const otpErrorMessageByCode: Readonly<Record<string, string>> = {
  'AUTH-401': 'That request could not be completed. Try again shortly.',
  'AUTH-410': 'That code is not right, or it has expired. Ask for a new one and try again.',
  'VAL-422': 'One of the fields is not valid. Check and try again.'
};

/** Fallbacks for the two pages that talk to the verification routes. */
export const otpFallbackMessage = 'That could not be completed. Please try again.';
export const resetFallbackMessage = 'The password could not be changed. Please try again.';

/** Turns a failed sign-in into a sentence a trader can act on, or a safe
 *  fallback when the failure is not something the contract described. */
@Injectable({ providedIn: 'root' })
export class ErrorCatalog {
  messageForSignIn(failure: unknown): string {
    if (failure instanceof HttpErrorResponse) {
      if (failure.status === 0) {
        return 'Could not reach the sign-in service. Check your connection and try again.';
      }
      const envelope = failure.error as ErrorEnvelope | undefined;
      if (envelope?.errorCode) {
        const message = authErrorMessageByCode[envelope.errorCode];
        if (message !== undefined) {
          return message;
        }
      }
    }
    return 'Sign-in could not be completed. Please try again.';
  }

  /** Turns a failed registration into a sentence a trader can act on. */
  messageForRegister(failure: unknown): string {
    if (failure instanceof HttpErrorResponse) {
      if (failure.status === 0) {
        return 'Could not reach the registration service. Check your connection and try again.';
      }
      const envelope = failure.error as ErrorEnvelope | undefined;
      if (envelope?.errorCode) {
        const message = registerErrorMessageByCode[envelope.errorCode];
        if (message !== undefined) {
          return message;
        }
      }
    }
    return 'Registration could not be completed. Please try again.';
  }

  /** Turns a failed email verification into a sentence a trader can act on. */
  messageForVerify(failure: unknown): string {
    return this.messageForOtpFailure(failure, otpFallbackMessage);
  }

  /** Turns a failed password reset into a sentence a trader can act on. */
  messageForReset(failure: unknown): string {
    return this.messageForOtpFailure(failure, resetFallbackMessage);
  }

  private messageForOtpFailure(failure: unknown, fallback: string): string {
    if (failure instanceof HttpErrorResponse) {
      if (failure.status === 0) {
        return 'Could not reach the verification service. Check your connection and try again.';
      }
      const envelope = failure.error as ErrorEnvelope | undefined;
      if (envelope?.errorCode) {
        const message = otpErrorMessageByCode[envelope.errorCode];
        if (message !== undefined) {
          return message;
        }
      }
    }
    return fallback;
  }
}