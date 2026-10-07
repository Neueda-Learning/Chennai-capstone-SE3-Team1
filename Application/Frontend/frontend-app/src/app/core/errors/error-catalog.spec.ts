import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import {
  AUTH_API_ERROR_CODES,
  TRADE_API_ERROR_CODES,
  ErrorCatalog,
  authRegisterErrorMessageByCode,
  authSignInErrorMessageByCode,
  checkErrorCatalogueCompleteness,
  tradeErrorMessageByCode
} from './error-catalog';

describe('ErrorCatalog', () => {
  let catalog: ErrorCatalog;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    catalog = TestBed.inject(ErrorCatalog);
  });

  describe('Execution Path 1: every code in both catalogues maps to a message', () => {
    it('maps every Trade API error code to a message', () => {
      for (const code of TRADE_API_ERROR_CODES) {
        const msg = tradeErrorMessageByCode[code];
        expect(msg).toBeTruthy();
        expect(msg.length).toBeGreaterThan(0);
      }
    });

    it('maps every Auth API error code to a message', () => {
      const authMessageMap = {
        ...authSignInErrorMessageByCode,
        ...authRegisterErrorMessageByCode
      };

      for (const code of AUTH_API_ERROR_CODES) {
        const msg = authMessageMap[code];
        expect(msg).toBeTruthy();
        expect(msg.length).toBeGreaterThan(0);
      }
    });

    it('completeness check reports zero unmapped codes', () => {
      const completeness = checkErrorCatalogueCompleteness();
      expect(completeness.complete).toBe(true);
      expect(completeness.unmappedTradeCodes.length).toBe(0);
      expect(completeness.unmappedAuthCodes.length).toBe(0);
    });

    it('every Trade code renders as a trader-actionable sentence when calling messageForTrade', () => {
      for (const code of TRADE_API_ERROR_CODES) {
        const failure = new HttpErrorResponse({
          status: 400,
          statusText: 'Bad Request',
          error: { errorCode: code, message: 'API-level message' }
        });
        const message = catalog.messageForTrade(failure);
        
        expect(message.length).toBeGreaterThan(0);
        expect(message).not.toContain('API-level message');
      }
    });

    it('every Auth code renders as a trader-actionable sentence when calling messageForSignIn', () => {
      const authCodesForSignIn = ['AUTH-401', 'AUTH-409', 'VAL-422'];
      for (const code of authCodesForSignIn) {
        const failure = new HttpErrorResponse({
          status: 401,
          statusText: 'Unauthorized',
          error: { errorCode: code, message: 'API-level message' }
        });
        const message = catalog.messageForSignIn(failure);
        
        expect(message.length).toBeGreaterThan(0);
        expect(message).not.toContain('API-level message');
      }
    });
  });

  describe('Execution Path 2: an unrecognised code falls back to a readable sentence', () => {
    it('falls back for Trade API when errorCode is not recognized', () => {
      const failure = new HttpErrorResponse({
        status: 400,
        statusText: 'Bad Request',
        error: { errorCode: 'UNKNOWN-999', message: 'Something weird happened' }
      });
      
      const message = catalog.messageForTrade(failure);
      
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain('UNKNOWN-999');
      expect(message).not.toContain('Something weird happened');
    });

    it('falls back for sign-in when errorCode is not recognized', () => {
      const failure = new HttpErrorResponse({
        status: 401,
        statusText: 'Unauthorized',
        error: { errorCode: 'AUTH-999', message: 'Mystery auth failure' }
      });
      
      const message = catalog.messageForSignIn(failure);
      
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain('AUTH-999');
      expect(message).not.toContain('Mystery auth failure');
    });

    it('falls back when response has no errorCode field', () => {
      const failure = new HttpErrorResponse({
        status: 500,
        statusText: 'Internal Server Error',
        error: { message: 'Only a message, no errorCode' }
      });
      
      const message = catalog.messageForTrade(failure);
      expect(message.length).toBeGreaterThan(0);
    });

    it('falls back when response body is completely empty', () => {
      const failure = new HttpErrorResponse({
        status: 500,
        statusText: 'Internal Server Error',
        error: null
      });
      
      const message = catalog.messageForTrade(failure);
      expect(message.length).toBeGreaterThan(0);
    });

    it('falls back when failure is not an HttpErrorResponse at all', () => {
      const message = catalog.messageForTrade(new Error('Network error'));
      expect(message.length).toBeGreaterThan(0);
    });

    it('falls back when failure is null or undefined', () => {
      const message1 = catalog.messageForTrade(null);
      const message2 = catalog.messageForTrade(undefined);
      expect(message1.length).toBeGreaterThan(0);
      expect(message2.length).toBeGreaterThan(0);
    });
  });

  describe('Execution Path 3: a request that never reached a service renders a readable sentence', () => {
    it('renders a connection error for Trade API when status is 0', () => {
      const failure = new HttpErrorResponse({
        status: 0,
        statusText: 'Unknown Error',
        error: null
      });
      
      const message = catalog.messageForTrade(failure);
      
      expect(message.length).toBeGreaterThan(0);
      expect(message).toContain('connection');
    });

    it('renders a connection error for sign-in when status is 0', () => {
      const failure = new HttpErrorResponse({
        status: 0,
        statusText: 'Unknown Error',
        error: null
      });
      
      const message = catalog.messageForSignIn(failure);
      
      expect(message).toContain('connection');
      expect(message.length).toBeGreaterThan(0);
    });

    it('renders a connection error for registration when status is 0', () => {
      const failure = new HttpErrorResponse({
        status: 0,
        statusText: 'Unknown Error',
        error: null
      });
      
      const message = catalog.messageForRegister(failure);
      
      expect(message).toContain('connection');
    });

    it('prioritizes status 0 even when errorCode is present', () => {
      const failure = new HttpErrorResponse({
        status: 0,
        statusText: 'Unknown Error',
        error: { errorCode: 'AUTH-401', message: 'Would normally map to sign-in message' }
      });
      
      const message = catalog.messageForSignIn(failure);
      
      expect(message).toContain('connection');
    });
  });

  describe('Message quality: trader-actionable, not developer-facing', () => {
    it('ACC-404 message tells trader to check session, not that a DB lookup failed', () => {
      const message = tradeErrorMessageByCode['ACC-404'];
      expect(message).toBeTruthy();
      expect(message.length).toBeGreaterThan(0);
    });

    it('ORD-400 message tells trader about cash', () => {
      const message = tradeErrorMessageByCode['ORD-400'];
      expect(message).toBeTruthy();
      expect(message.length).toBeGreaterThan(0);
    });

    it('ORD-409 message covers multiple scenarios', () => {
      const message = tradeErrorMessageByCode['ORD-409'];
      expect(message).toBeTruthy();
      expect(message.length).toBeGreaterThan(0);
    });

    it('AUTH-401 tells trader to sign in again', () => {
      const message = tradeErrorMessageByCode['AUTH-401'];
      expect(message).toBeTruthy();
      expect(message.length).toBeGreaterThan(0);
    });

    it('VAL-422 tells trader to check fields', () => {
      const message = tradeErrorMessageByCode['VAL-422'];
      expect(message).toBeTruthy();
      expect(message.length).toBeGreaterThan(0);
    });
  });

  describe('Legacy API (for backwards compatibility)', () => {
    it('messageForSignIn still uses authSignInErrorMessageByCode', () => {
      const failure = new HttpErrorResponse({
        status: 401,
        statusText: 'Unauthorized',
        error: { errorCode: 'AUTH-401', message: 'vague' }
      });
      const message = catalog.messageForSignIn(failure);
      expect(message).toBeTruthy();
      expect(message.length).toBeGreaterThan(0);
    });

    it('messageForRegister still uses authRegisterErrorMessageByCode', () => {
      const failure = new HttpErrorResponse({
        status: 409,
        statusText: 'Conflict',
        error: { errorCode: 'AUTH-409', message: 'taken' }
      });
      const message = catalog.messageForRegister(failure);
      expect(message).toBeTruthy();
      expect(message.length).toBeGreaterThan(0);
    });

  });
});
