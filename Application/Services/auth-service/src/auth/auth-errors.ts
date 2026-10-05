import { HttpException, HttpStatus } from '@nestjs/common';

export type AuthErrorCode =
  'AUTH-401' | 'AUTH-409' | 'AUTH-410' | 'VAL-422' | 'INTERNAL-500';

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
    message: 'Unauthorised',
  },
  USERNAME_TAKEN: {
    code: 'AUTH-409',
    status: HttpStatus.CONFLICT,
    message: 'Registration failed',
  },
  INVALID_INPUT: {
    code: 'VAL-422',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Invalid input',
  },
  OTP_INVALID: {
    code: 'AUTH-410',
    status: HttpStatus.GONE,
    message: 'The verification code is invalid or has expired',
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
            : errorCode === 'AUTH-410'
              ? HttpStatus.GONE
              : HttpStatus.UNPROCESSABLE_ENTITY),
    );
  }

  // Deliberately vague (see contracts/auth-api.yaml's Unauthorised response and
  // AUTH_IMPLEMENTATION.md): a specific message here ("wrong password", "unknown user", ...)
  // would tell an attacker which half of the credential pair to keep guessing.
  static unauthorised(message = 'Unauthorised'): AuthServiceException {
    return new AuthServiceException('AUTH-401', message);
  }

  // Same reasoning as unauthorised() - "Username already registered" vs. "Email already
  // registered" would let a caller enumerate which accounts exist on this service.
  static usernameTaken(): AuthServiceException {
    return new AuthServiceException('AUTH-409', 'Registration failed');
  }

  static emailTaken(): AuthServiceException {
    return new AuthServiceException('AUTH-409', 'Registration failed');
  }

  static invalidInput(message = 'Invalid input'): AuthServiceException {
    return new AuthServiceException('VAL-422', message);
  }

  /**
   * One message for every way an OTP can fail to verify - unknown email, no code
   * pending, wrong digits, exhausted attempts - so a caller cannot tell which
   * emails have an account. 410 rather than 401: the request is understood, the
   * code it carried is simply gone.
   */
  static otpInvalid(
    message = 'The verification code is invalid or has expired',
  ): AuthServiceException {
    return new AuthServiceException('AUTH-410', message);
  }

  static internal(): AuthServiceException {
    return new AuthServiceException('INTERNAL-500', 'Internal error');
  }
}
