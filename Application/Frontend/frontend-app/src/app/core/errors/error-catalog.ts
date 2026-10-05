import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

export interface ErrorEnvelope {
  errorCode?: string;
  message?: string;
}

export interface ErrorCatalogueEntry {
  code: string;
  httpStatus: number;
  message: string;
  appliesTo: 'trade' | 'auth' | 'both';
}

export const TRADE_API_ERROR_CODES = ['ACC-404', 'ACC-403', 'INS-404', 'ORD-400', 'ORD-409', 'VAL-422', 'AUTH-401', 'TRF-400', 'TRF-409', 'INTERNAL-500'] as const;

export const AUTH_API_ERROR_CODES = ['AUTH-401', 'AUTH-409', 'VAL-422', 'AUTH-410'] as const;

export const ALL_ERROR_CODES = ['ACC-404', 'ACC-403', 'INS-404', 'ORD-400', 'ORD-409', 'VAL-422', 'AUTH-401', 'AUTH-409', 'AUTH-410', 'TRF-400', 'TRF-409', 'INTERNAL-500'] as const;

export const AUTH_SIGNIN_ERROR_CODES = ['AUTH-401', 'AUTH-409', 'VAL-422'] as const;

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

export const authSignInErrorMessageByCode: Readonly<Record<string, string>> = {
  'AUTH-401': 'The username or password was not recognised. Check them and try again.',
  'AUTH-409': 'This account cannot be signed in to. Try again shortly.',
  'VAL-422': 'One of the sign-in fields is not valid. Check and try again.'
};

export const authErrorMessageByCode = authSignInErrorMessageByCode;

export const authRegisterErrorMessageByCode: Readonly<Record<string, string>> = {
  'AUTH-401': 'Registration could not be completed. Try again shortly.',
  'AUTH-409': 'That username or email is already registered. Sign in, or use a different one.',
  'VAL-422': 'One of the registration fields is not valid. Check the highlighted fields and try again.'
};

export const registerErrorMessageByCode = authRegisterErrorMessageByCode;

export const authOtpErrorMessageByCode: Readonly<Record<string, string>> = {
  'AUTH-401': 'That request could not be completed. Try again shortly.',
  'AUTH-410': 'That code is not right, or it has expired. Ask for a new one and try again.',
  'VAL-422': 'One of the fields is not valid. Check and try again.'
};

export const otpErrorMessageByCode = authOtpErrorMessageByCode;

export const otpFallbackMessage = 'That could not be completed. Please try again.';
export const resetFallbackMessage = 'The password could not be changed. Please try again.';

export const authSignInFallback = 'Sign-in could not be completed. Please try again.';
export const authRegisterFallback = 'Registration could not be completed. Please try again.';
export const authVerifyFallback = 'Email verification could not be completed. Please try again.';
export const authResetFallback = 'Password reset could not be completed. Please try again.';
export const tradeFallbackMessage = 'Could not complete that operation. Please try again.';

export const authSignInConnectionError = 'Could not reach the sign-in service. Check your connection and try again.';
export const authRegisterConnectionError = 'Could not reach the registration service. Check your connection and try again.';
export const authVerifyConnectionError = 'Could not reach the verification service. Check your connection and try again.';
export const authResetConnectionError = 'Could not reach the password reset service. Check your connection and try again.';
export const tradeConnectionError = 'Could not reach the trading service. Check your connection and try again.';

export interface CatalogueCompleteness {
  complete: boolean;
  tradeComplete: boolean;
  authComplete: boolean;
  unmappedTradeCodes: string[];
  unmappedAuthCodes: string[];
  totalCodesInContracts: number;
  totalCodesMapped: number;
}

export function checkErrorCatalogueCompleteness(): CatalogueCompleteness {
  const unmappedTradeCodes = (TRADE_API_ERROR_CODES as readonly string[]).filter(
    code => !(code in tradeErrorMessageByCode)
  );
  
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

@Injectable({ providedIn: 'root' })
export class ErrorCatalog {
  private extractMessage(
    failure: unknown,
    messageMap: Readonly<Record<string, string>>,
    connectionErrorMsg: string,
    fallbackMsg: string
  ): string {
    if (!(failure instanceof HttpErrorResponse)) {
      return fallbackMsg;
    }

    if (failure.status === 0) {
      return connectionErrorMsg;
    }

    const envelope = failure.error as ErrorEnvelope | undefined;
    if (envelope?.errorCode) {
      const message = messageMap[envelope.errorCode];
      if (message !== undefined) {
        return message;
      }
    }

    return fallbackMsg;
  }

  messageForSignIn(failure: unknown): string {
    return this.extractMessage(
      failure,
      authSignInErrorMessageByCode,
      authSignInConnectionError,
      authSignInFallback
    );
  }

  messageForRegister(failure: unknown): string {
    return this.extractMessage(
      failure,
      authRegisterErrorMessageByCode,
      authRegisterConnectionError,
      authRegisterFallback
    );
  }

  messageForVerify(failure: unknown): string {
    return this.extractMessage(
      failure,
      authOtpErrorMessageByCode,
      authVerifyConnectionError,
      authVerifyFallback
    );
  }

  messageForReset(failure: unknown): string {
    return this.extractMessage(
      failure,
      authOtpErrorMessageByCode,
      authResetConnectionError,
      authResetFallback
    );
  }

  messageForTrade(failure: unknown): string {
    return this.extractMessage(
      failure,
      tradeErrorMessageByCode,
      tradeConnectionError,
      tradeFallbackMessage
    );
  }}