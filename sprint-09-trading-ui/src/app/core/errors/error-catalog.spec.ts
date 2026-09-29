import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import {
  AUTH_ERROR_CODES,
  ErrorCatalog,
  authErrorMessageByCode
} from './error-catalog';

describe('ErrorCatalog', () => {
  let catalog: ErrorCatalog;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    catalog = TestBed.inject(ErrorCatalog);
  });

  function signInFailure(
    status: number,
    statusText: string,
    envelope: unknown = null
  ): HttpErrorResponse {
    return new HttpErrorResponse({ status, statusText, error: envelope });
  }

  it('names a refused sign-in as unrecognised credentials', () => {
    const message = catalog.messageForSignIn(
      signInFailure(401, 'Unauthorized', { errorCode: 'AUTH-401', message: 'vague' })
    );
    expect(message).toContain('not recognised');
  });

  it('explains when the service is unreachable', () => {
    const message = catalog.messageForSignIn(signInFailure(0, 'Unknown Error'));
    expect(message).toContain('connection');
  });

  it('falls back to a generic sentence when there is no envelope', () => {
    const message = catalog.messageForSignIn(signInFailure(500, 'Server Error'));
    expect(message).toContain('could not be completed');
  });

  it('falls back for a failure that is not an HTTP response at all', () => {
    expect(catalog.messageForSignIn(new Error('boom'))).toContain('could not be completed');
  });

  it('renders a message for every code the auth contract can send', () => {
    for (const code of AUTH_ERROR_CODES) {
      expect(authErrorMessageByCode[code]).toBeTruthy();
      const message = catalog.messageForSignIn(signInFailure(401, 'Unauthorized', { errorCode: code }));
      expect(message).not.toContain('could not be completed');
      expect(message.length).toBeGreaterThan(0);
    }
  });
});