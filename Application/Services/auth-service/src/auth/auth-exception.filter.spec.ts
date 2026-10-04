import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AuthExceptionFilter } from './auth-exception.filter';
import { AuthServiceException } from './auth-errors';

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

describe('AuthExceptionFilter', () => {
  let filter: AuthExceptionFilter;
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let response: MockResponse;
  let host: ArgumentsHost;

  function makeHost(): ArgumentsHost {
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { url: '/auth/login' };
    return {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
  }

  beforeEach(() => {
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    filter = new AuthExceptionFilter(logger as unknown as typeof logger);
    host = makeHost();
  });

  it('writes the exact envelope for AuthServiceException', () => {
    filter.catch(AuthServiceException.unauthorised(), host);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(response.json).toHaveBeenCalledWith({
      errorCode: 'AUTH-401',
      message: 'Unauthorised',
    });
  });

  it('maps BadRequestException (validation) to VAL-422', () => {
    filter.catch(
      new HttpException({ message: 'bad' }, HttpStatus.BAD_REQUEST),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith({
      errorCode: 'VAL-422',
      message: 'Invalid input',
    });
  });

  it('maps a raw 401 to AUTH-401 envelope', () => {
    filter.catch(new HttpException('nope', HttpStatus.UNAUTHORIZED), host);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      errorCode: 'AUTH-401',
      message: 'Unauthorised',
    });
  });

  it('returns a generic envelope for an unknown error and logs it', () => {
    filter.catch(new Error('boom'), host);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      errorCode: 'INTERNAL-500',
      message: 'Internal error',
    });
    expect(logger.error).toHaveBeenCalled();
  });
});
