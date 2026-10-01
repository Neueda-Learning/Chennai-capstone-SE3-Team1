import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

/**
 * The error envelope both services' contracts guarantee.
 * Clients MUST branch on errorCode, never on status alone, because
 * both 404 and 409 carry multiple codes (e.g., ACC-404 and INS-404 both use 404).
 */
export interface ErrorEnvelope {
  errorCode?: string;
  message?: string;
}

/**
 * Complete error code catalogue from both API contracts.
 * This structure defines every code each API can return, marked with its HTTP status
 * and a trader-actionable message. It also tracks completeness: if a code is in the
 * API contract but not in the message map, it will fail the completeness check at startup.
 */
export interface ErrorCatalogueEntry {
  code: string;
  httpStatus: number;
  message: string;
  appliesTo: 'trade' | 'auth' | 'both';
}

/**
 * Every error code from the Trade REST API contract (sprint-06-api).
 * Defined in contracts/trade-api.yaml.
 */
export const TRADE_API_ERROR_CODES = ['ACC-404', 'ACC-403', 'INS-404', 'ORD-400', 'ORD-409', 'VAL-422', 'AUTH-401', 'TRF-400', 'TRF-409', 'INTERNAL-500'] as const;

/**
 * Every error code from the Auth service contract (sprint-08-auth).
 * Defined in contracts/auth-api.yaml.
 */
export const AUTH_API_ERROR_CODES = ['AUTH-401', 'AUTH-409', 'VAL-422', 'AUTH-410'] as const;

/**
 * Consolidated list of all unique error codes from both contracts.
 */
export const ALL_ERROR_CODES = ['ACC-404', 'ACC-403', 'INS-404', 'ORD-400', 'ORD-409', 'VAL-422', 'AUTH-401', 'AUTH-409', 'AUTH-410', 'TRF-400', 'TRF-409', 'INTERNAL-500'] as const;

/**
 * Every `errorCode` the auth contract can return on sign-in.
 * Subset of AUTH_API_ERROR_CODES, used by the sign-in page.
 */
export const AUTH_SIGNIN_ERROR_CODES = ['AUTH-401', 'AUTH-409', 'VAL-422'] as const;

/**
 * Complete Trade API error messages. Maps every code the Trade REST API can return
 * to a trader-actionable sentence (not a developer-facing explanation).
 */
export const tradeErrorMessageByCode: Readonly<Record<string, string>> = {
  'ACC-404': 'The account could not be found. Check your session and try again.',
  'ACC-403': 'This account is not active, or is not the one this sign-in may trade.',
  'INS-404': 'The instrument is not one that can be traded.',
  'ORD-400': 'There is not enough cash for this order.',
  'ORD-409': 'Not enough of the holding to sell, or this order has already been placed.',
  'VAL-422': 'A field is not acceptable. Check the highlighted fields and try again.',
  'AUTH-401': 'The session has expired or the sign-in was refused. Please sign in again.',
  'TRF-400': 'The transfer side being debited cannot cover the amount.',
  'TRF-409': 'The idempotency key for this transfer has already been used.',
  'INTERNAL-500': 'An unexpected error occurred. Please try again shortly.'
};

/**
 * Complete Auth API error messages for sign-in flow.
 * The auth service deliberately returns the same vague `AUTH-401` for every
 * bad-credential case, so the message cannot say which field was wrong —
 * naming it would hand an attacker a username oracle.
 */
export const authSignInErrorMessageByCode: Readonly<Record<string, string>> = {
  'AUTH-401': 'The username or password was not recognised. Check them and try again.',
  'AUTH-409': 'This account cannot be signed in to. Try again shortly.',
  'VAL-422': 'One of the sign-in fields is not valid. Check and try again.'
};

/**
 * Alias for backwards compatibility with existing code.
 * @deprecated Use authSignInErrorMessageByCode instead.
 */
export const authErrorMessageByCode = authSignInErrorMessageByCode;

/**
 * Registration failures to sentences, from the same envelope. `AUTH-409`
 * means the username or the email is already taken; `VAL-422` that a field
 * failed validation. `AUTH-401` cannot happen on the public route, and is
 * mapped only so no path leaks a raw failure.
 */
export const authRegisterErrorMessageByCode: Readonly<Record<string, string>> = {
  'AUTH-401': 'Registration could not be completed. Try again shortly.',
  'AUTH-409': 'That username or email is already registered. Sign in, or use a different one.',
  'VAL-422': 'One of the registration fields is not valid. Check the highlighted fields and try again.'
};

/**
 * Alias for backwards compatibility with existing code.
 * @deprecated Use authRegisterErrorMessageByCode instead.
 */
export const registerErrorMessageByCode = authRegisterErrorMessageByCode;

/**
 * Email-verification and password-reset failures to sentences. `AUTH-410` is the
 * service's single answer for every way a one-time code can fail, so the message
 * cannot promise which one it was. `VAL-422` on a reset means the new password
 * did not meet the policy.
 */
export const authOtpErrorMessageByCode: Readonly<Record<string, string>> = {
  'AUTH-401': 'That request could not be completed. Try again shortly.',
  'AUTH-410': 'That code is not right, or it has expired. Ask for a new one and try again.',
  'VAL-422': 'One of the fields is not valid. Check and try again.'
};

/**
 * Alias for backwards compatibility with existing code.
 * @deprecated Use authOtpErrorMessageByCode instead.
 */
export const otpErrorMessageByCode = authOtpErrorMessageByCode;

/** Fallbacks for the two pages that talk to the verification routes. */
export const otpFallbackMessage = 'That could not be completed. Please try again.';
export const resetFallbackMessage = 'The password could not be changed. Please try again.';

/**
 * Fallback messages for error scenarios where no specific code is available.
 * These render when:
 * 1. The response body has no errorCode field
 * 2. The errorCode is not recognized in the mapping
 * 3. The failure is not an HttpErrorResponse at all
 */
export const authSignInFallback = 'Sign-in could not be completed. Please try again.';
export const authRegisterFallback = 'Registration could not be completed. Please try again.';
export const authVerifyFallback = 'Email verification could not be completed. Please try again.';
export const authResetFallback = 'Password reset could not be completed. Please try again.';
export const tradeFallbackMessage = 'Could not complete that operation. Please try again.';

/**
 * Service connection error messages. These render when the request never reaches
 * the server (HTTP status 0), usually indicating:
 * - Service is down
 * - CORS policy blocking the request
 * - Network unreachable
 */
export const authSignInConnectionError = 'Could not reach the sign-in service. Check your connection and try again.';
export const authRegisterConnectionError = 'Could not reach the registration service. Check your connection and try again.';
export const authVerifyConnectionError = 'Could not reach the verification service. Check your connection and try again.';
export const authResetConnectionError = 'Could not reach the password reset service. Check your connection and try again.';
export const tradeConnectionError = 'Could not reach the trading service. Check your connection and try again.';

/**
 * Completeness check: verifies that every error code from both API contracts
 * has a mapped message. Returns an object with a 'complete' flag and 'unmappedCodes'
 * listing any codes from the contracts that lack a message.
 */
export interface CatalogueCompleteness {
  complete: boolean;
  tradeComplete: boolean;
  authComplete: boolean;
  unmappedTradeCodes: string[];
  unmappedAuthCodes: string[];
  totalCodesInContracts: number;
  totalCodesMapped: number;
}

/**
 * Check completeness of error code mappings. Call this at app startup
 * to detect any codes from the contracts that are not yet mapped.
 */
export function checkErrorCatalogueCompleteness(): CatalogueCompleteness {
  const unmappedTradeCodes = (TRADE_API_ERROR_CODES as readonly string[]).filter(
    code => !(code in tradeErrorMessageByCode)
  );
  
  // For auth codes, check if each code is present in ANY of the auth message maps
  // since different endpoints use different subsets (e.g., AUTH-410 only in OTP flow)
  const allAuthMappings = {
    ...authSignInErrorMessageByCode,
    ...authRegisterErrorMessageByCode,
    ...authOtpErrorMessageByCode
  };
  
  const unmappedAuthCodes = (AUTH_API_ERROR_CODES as readonly string[]).filter(
    code => !(code in allAuthMappings)
  );

  const tradeComplete = unmappedTradeCodes.length === 0;
  const authComplete = unmappedAuthCodes.length === 0;

  return {
    complete: tradeComplete && authComplete,
    tradeComplete,
    authComplete,
    unmappedTradeCodes,
    unmappedAuthCodes,
    totalCodesInContracts: ALL_ERROR_CODES.length,
    totalCodesMapped: Object.keys(tradeErrorMessageByCode).length + Object.keys(authSignInErrorMessageByCode).length
  };
}

/**
 * Turns a failed API call into a trader-actionable message.
 * Handles three execution paths as per acceptance criteria:
 * 1. Every code in both catalogues maps to a message
 * 2. An unrecognised code falls back to a readable sentence
 * 3. A request that never reached a service (status 0) renders a readable sentence
 */
@Injectable({ providedIn: 'root' })
export class ErrorCatalog {
  /**
   * Extract trader-actionable message from an HTTP error response.
   * Branches on errorCode (never on status), handles status 0 specially.
   * 
   * Execution paths:
   * - Status 0 (network/CORS error) → service connection error message
   * - Response with valid errorCode in message map → mapped message
   * - Response with errorCode not in map → generic fallback
   * - No response body or no errorCode → generic fallback
   * - Not an HttpErrorResponse at all → generic fallback
   */
  private extractMessage(
    failure: unknown,
    messageMap: Readonly<Record<string, string>>,
    connectionErrorMsg: string,
    fallbackMsg: string
  ): string {
    if (!(failure instanceof HttpErrorResponse)) {
      return fallbackMsg;
    }

    // Execution path: request never reached service (status 0 = network/CORS error)
    if (failure.status === 0) {
      return connectionErrorMsg;
    }

    // Try to extract and map the error code from response body
    const envelope = failure.error as ErrorEnvelope | undefined;
    if (envelope?.errorCode) {
      const message = messageMap[envelope.errorCode];
      // Execution path: every code in catalogue maps to a message
      if (message !== undefined) {
        return message;
      }
      // Execution path: unrecognised code falls back to readable sentence
    }

    return fallbackMsg;
  }

  /**
   * Sign-in failure message. Returns either:
   * - Mapped message for known auth error codes (AUTH-401, AUTH-409, VAL-422)
   * - Service connection error if status is 0
   * - Generic fallback if code unknown or missing
   */
  messageForSignIn(failure: unknown): string {
    return this.extractMessage(
      failure,
      authSignInErrorMessageByCode,
      authSignInConnectionError,
      authSignInFallback
    );
  }

  /**
   * Registration failure message. Returns either:
   * - Mapped message for auth error codes
   * - Service connection error if status is 0
   * - Generic fallback if code unknown or missing
   */
  messageForRegister(failure: unknown): string {
    return this.extractMessage(
      failure,
      authRegisterErrorMessageByCode,
      authRegisterConnectionError,
      authRegisterFallback
    );
  }

  /**
   * Email verification failure message. Returns either:
   * - Mapped message for auth error codes including AUTH-410 (OTP issues)
   * - Service connection error if status is 0
   * - Generic fallback if code unknown or missing
   */
  messageForVerify(failure: unknown): string {
    return this.extractMessage(
      failure,
      authOtpErrorMessageByCode,
      authVerifyConnectionError,
      authVerifyFallback
    );
  }

  /**
   * Password reset failure message. Returns either:
   * - Mapped message for auth error codes including AUTH-410 (OTP issues)
   * - Service connection error if status is 0
   * - Generic fallback if code unknown or missing
   */
  messageForReset(failure: unknown): string {
    return this.extractMessage(
      failure,
      authOtpErrorMessageByCode,
      authResetConnectionError,
      authResetFallback
    );
  }

  /**
   * Trade API failure message. Used for order history, placement, portfolio, 
   * and other trading operations. Returns either:
   * - Mapped message for known trade error codes (ACC-404, ORD-400, etc.)
   * - Service connection error if status is 0
   * - Generic fallback if code unknown or missing
   */
  messageForTrade(failure: unknown): string {
    return this.extractMessage(
      failure,
      tradeErrorMessageByCode,
      tradeConnectionError,
      tradeFallbackMessage
    );
  }}