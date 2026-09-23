import { HttpException, HttpStatus } from '@nestjs/common';

export type AuthErrorCode =
  'AUTH-401' | 'AUTH-409' | 'VAL-422' | 'INTERNAL-500';

export interface ErrorEnvelope {
  errorCode: AuthErrorCode;
  message: string;
}

export const AUTH_ERRORS: Record<
  string,
  { code: AuthErrorCode; status: number; message: string }
> = {
  UNAUTHORISED: {
    code: 'AUTH-401',
    status: HttpStatus.UNAUTHORIZED,
    message: 'Invalid username or password',
  },
  USERNAME_TAKEN: {
    code: 'AUTH-409',
    status: HttpStatus.CONFLICT,
    message: 'Username already registered',
  },
  INVALID_INPUT: {
    code: 'VAL-422',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Invalid input',
  },
  INTERNAL: {
    code: 'INTERNAL-500',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Internal error',
  },
};

export class AuthServiceException extends HttpException {
  constructor(errorCode: AuthErrorCode, message?: string, status?: number) {
    super(
      { errorCode, message: message ?? errorCode },
      status ??
        (errorCode === 'AUTH-401'
          ? HttpStatus.UNAUTHORIZED
          : errorCode === 'AUTH-409'
            ? HttpStatus.CONFLICT
            : HttpStatus.UNPROCESSABLE_ENTITY),
    );
  }

  static unauthorised(message = 'Invalid username or password'): AuthServiceException {
    return new AuthServiceException('AUTH-401', message);
  }

  static usernameTaken(): AuthServiceException {
    return new AuthServiceException('AUTH-409', 'Username already registered');
  }

  static accountNotFound(): AuthServiceException {
    return new AuthServiceException(
      'VAL-422',
      'Account ID does not exist. Ensure the trading account is created first.',
    );
  }

  static accountAlreadyRegistered(): AuthServiceException {
    return new AuthServiceException(
      'AUTH-409',
      'This trading account is already registered to another user. Each account can only have one registered user.',
    );
  }

  static invalidInput(message = 'Invalid input'): AuthServiceException {
    return new AuthServiceException('VAL-422', message);
  }

  static internal(): AuthServiceException {
    return new AuthServiceException('INTERNAL-500', 'Internal error');
  }
}
