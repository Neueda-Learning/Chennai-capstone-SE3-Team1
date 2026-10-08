import { Test, TestingModule } from '@nestjs/testing';
import { KafkaHealthIndicator } from './kafka.indicator';
import { ConfigService } from '@nestjs/config';

// A made-up broker: the real address comes from Application/Config/services.env via configuration.ts.
const BROKER_HOST = 'broker.test';
const BROKER_PORT = 4242;
const BROKER = `${BROKER_HOST}:${BROKER_PORT}`;

const mockSocket = {
  setTimeout: jest.fn(),
  on: jest.fn(),
  destroy: jest.fn(),
  connect: jest.fn(),
};

const mockLogger = {
  logFromSource: jest.fn(),
};

jest.mock('net', () => ({
  Socket: jest.fn().mockImplementation(() => mockSocket),
}));

describe('KafkaHealthIndicator', () => {
  let indicator: KafkaHealthIndicator;
  let configService: ConfigService;

  beforeEach(async () => {
    const values: Record<string, any> = { 'app.kafka.broker': BROKER };
    configService = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => {
        if (!(key in values)) {
          throw new Error(`${key} is not configured`);
        }
        return values[key];
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KafkaHealthIndicator,
        { provide: ConfigService, useValue: configService },
        { provide: 'MULTI_FILE_LOGGER', useValue: mockLogger },
      ],
    }).compile();

    indicator = module.get<KafkaHealthIndicator>(KafkaHealthIndicator);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockSocket.on.mockReset();
    mockSocket.connect.mockReset();
    mockSocket.destroy.mockReset();
    mockSocket.setTimeout.mockReset();
    mockLogger.logFromSource.mockReset();
  });

  describe('isHealthy', () => {
    it('should return healthy when Kafka broker is reachable', async () => {
      mockSocket.on.mockImplementation(
        (event: string, callback: () => void) => {
          if (event === 'connect') {
            setImmediate(callback);
          }
          return mockSocket;
        },
      );

      const result = await indicator.isHealthy('kafka');

      expect(result).toEqual({
        kafka: {
          status: 'up',
          message: 'Kafka broker reachable',
          broker: BROKER,
        },
      });
      expect(mockSocket.connect).toHaveBeenCalledWith(BROKER_PORT, BROKER_HOST);
      expect(mockLogger.logFromSource).toHaveBeenCalledWith(
        'kafka',
        'log',
        'Health check passed',
        'kafka',
        { broker: BROKER },
      );
    });

    it('should throw HealthCheckError when Kafka broker is unreachable', async () => {
      mockSocket.on.mockImplementation(
        (event: string, callback: (err: Error) => void) => {
          if (event === 'error') {
            setImmediate(() => callback(new Error('ECONNREFUSED')));
          }
          return mockSocket;
        },
      );

      await expect(indicator.isHealthy('kafka')).rejects.toThrow(
        'Kafka health check failed',
      );
      expect(mockLogger.logFromSource).toHaveBeenCalledWith(
        'kafka',
        'error',
        'Health check failed',
        'kafka',
        { broker: BROKER },
        expect.any(String),
      );
    });

    it('should throw HealthCheckError on timeout', async () => {
      mockSocket.on.mockImplementation(
        (event: string, callback: () => void) => {
          if (event === 'timeout') {
            setImmediate(callback);
          }
          return mockSocket;
        },
      );

      await expect(indicator.isHealthy('kafka')).rejects.toThrow(
        'Kafka health check failed',
      );
      expect(mockLogger.logFromSource).toHaveBeenCalledWith(
        'kafka',
        'error',
        'Health check failed',
        'kafka',
        { broker: BROKER },
        expect.any(String),
      );
    });
  });
});
