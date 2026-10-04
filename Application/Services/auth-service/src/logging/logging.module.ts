import { Module, Global } from '@nestjs/common';
import { MultiFileLogger, createSourceLogger } from './logger.service';

@Global()
@Module({
  providers: [
    {
      provide: 'MULTI_FILE_LOGGER',
      useClass: MultiFileLogger,
    },
    {
      provide: 'HEALTH_LOGGER',
      useFactory: (logger: MultiFileLogger) =>
        createSourceLogger(logger, 'health'),
      inject: ['MULTI_FILE_LOGGER'],
    },
    {
      provide: 'DATABASE_LOGGER',
      useFactory: (logger: MultiFileLogger) =>
        createSourceLogger(logger, 'database'),
      inject: ['MULTI_FILE_LOGGER'],
    },
    {
      provide: 'KAFKA_LOGGER',
      useFactory: (logger: MultiFileLogger) =>
        createSourceLogger(logger, 'kafka'),
      inject: ['MULTI_FILE_LOGGER'],
    },
    {
      provide: 'ORDERS_LOGGER',
      useFactory: (logger: MultiFileLogger) =>
        createSourceLogger(logger, 'orders'),
      inject: ['MULTI_FILE_LOGGER'],
    },
    {
      provide: 'MARKET_DATA_LOGGER',
      useFactory: (logger: MultiFileLogger) =>
        createSourceLogger(logger, 'market-data'),
      inject: ['MULTI_FILE_LOGGER'],
    },
    {
      provide: 'TRADE_EVENTS_LOGGER',
      useFactory: (logger: MultiFileLogger) =>
        createSourceLogger(logger, 'trade-events'),
      inject: ['MULTI_FILE_LOGGER'],
    },
    {
      provide: 'HTTP_LOGGER',
      useFactory: (logger: MultiFileLogger) =>
        createSourceLogger(logger, 'http'),
      inject: ['MULTI_FILE_LOGGER'],
    },
    {
      provide: 'AUTH_LOGGER',
      useFactory: (logger: MultiFileLogger) =>
        createSourceLogger(logger, 'auth'),
      inject: ['MULTI_FILE_LOGGER'],
    },
  ],
  exports: [
    'MULTI_FILE_LOGGER',
    'HEALTH_LOGGER',
    'DATABASE_LOGGER',
    'KAFKA_LOGGER',
    'ORDERS_LOGGER',
    'MARKET_DATA_LOGGER',
    'TRADE_EVENTS_LOGGER',
    'HTTP_LOGGER',
    'AUTH_LOGGER',
  ],
})
export class LoggingModule {}
