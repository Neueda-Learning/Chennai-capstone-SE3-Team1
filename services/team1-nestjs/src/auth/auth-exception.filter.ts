import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthServiceException, ErrorEnvelope } from './auth-errors';

interface AuthSourceLogger {
  log: (
    message: string,
    context?: string,
    metadata?: Record<string, any>,
  ) => void;
  error: (
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, any>,
  ) => void;
  warn: (
    message: string,
    context?: string,
    metadata?: Record<string, any>,
  ) => void;
}

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject('AUTH_LOGGER') private readonly logger: AuthSourceLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.toEnvelope(exception, request.url);

    if (status >= 500) {
      this.logger.error(
        'Unhandled exception',
        exception instanceof Error ? exception.stack : undefined,
        'exception-filter',
        { path: request.url },
      );
    }

    response.status(status).json(body);
  }

  private toEnvelope(
    exception: unknown,
    _path: string,
  ): { status: number; body: ErrorEnvelope } {
    if (exception instanceof AuthServiceException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const body =
        typeof res === 'object' && res !== null
          ? (res as ErrorEnvelope)
          : { errorCode: 'INTERNAL-500' as const, message: 'Internal error' };
      return { status, body };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      switch (status) {
        case HttpStatus.BAD_REQUEST:
          return {
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            body: { errorCode: 'VAL-422', message: 'Invalid input' },
          };
        case HttpStatus.UNAUTHORIZED:
        case HttpStatus.FORBIDDEN:
          return {
            status: HttpStatus.UNAUTHORIZED,
            body: { errorCode: 'AUTH-401', message: 'Unauthorised' },
          };
        default:
          return {
            status,
            body: { errorCode: 'INTERNAL-500', message: 'Internal error' },
          };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { errorCode: 'INTERNAL-500', message: 'Internal error' },
    };
  }
}
