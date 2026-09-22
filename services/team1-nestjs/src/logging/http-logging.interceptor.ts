import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MultiFileLogger } from '../logging/logger.service';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  constructor(
    @Inject('MULTI_FILE_LOGGER') private readonly logger: MultiFileLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || '';
    const startTime = Date.now();

    this.logger.logFromSource(
      'http',
      'log',
      `${method} ${url}`,
      'HttpLoggingInterceptor',
      {
        ip,
        userAgent,
        requestId: headers['x-request-id'] || headers['x-correlation-id'],
      },
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const { statusCode } = response;
          this.logger.logFromSource(
            'http',
            'log',
            `${method} ${url} ${statusCode}`,
            'HttpLoggingInterceptor',
            {
              ip,
              userAgent,
              statusCode,
              duration: `${duration}ms`,
              requestId: headers['x-request-id'] || headers['x-correlation-id'],
            },
          );
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const statusCode = error.status || 500;
          this.logger.logFromSource(
            'http',
            'error',
            `${method} ${url} ${statusCode}`,
            'HttpLoggingInterceptor',
            {
              ip,
              userAgent,
              statusCode,
              duration: `${duration}ms`,
              error: error.message,
              requestId: headers['x-request-id'] || headers['x-correlation-id'],
            },
            error.stack,
          );
        },
      }),
    );
  }
}
