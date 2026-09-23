import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseHealthIndicator } from './database.indicator';
import { Pool } from 'pg';

const mockPool = {
  connect: jest.fn(),
  query: jest.fn(),
  end: jest.fn(),
  release: jest.fn(),
};

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const mockLogger = {
  logFromSource: jest.fn(),
};

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
}));

describe('DatabaseHealthIndicator', () => {
  let indicator: DatabaseHealthIndicator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseHealthIndicator,
        { provide: Pool, useValue: mockPool },
        { provide: 'DATABASE_LOGGER', useValue: mockLogger },
      ],
    }).compile();

    indicator = module.get<DatabaseHealthIndicator>(DatabaseHealthIndicator);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockPool.connect.mockReset();
    mockPool.end.mockReset();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockLogger.logFromSource.mockReset();
  });

  describe('isHealthy', () => {
    it('should return healthy when database is reachable', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
      mockClient.release.mockImplementation(() => {});
      mockPool.connect.mockResolvedValue(mockClient);

      const result = await indicator.isHealthy('database');

      expect(result).toEqual({
        database: {
          status: 'up',
          message: 'Database connection successful',
        },
      });
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('SELECT 1');
      expect(mockClient.release).toHaveBeenCalled();
      expect(mockLogger.logFromSource).toHaveBeenCalledWith(
        'database',
        'log',
        'Health check passed',
        'database',
      );
    });

    it('should throw HealthCheckError when database is unreachable', async () => {
      mockPool.connect.mockRejectedValue(new Error('Connection refused'));

      await expect(indicator.isHealthy('database')).rejects.toThrow(
        'Database health check failed',
      );
      expect(mockLogger.logFromSource).toHaveBeenCalledWith(
        'database',
        'error',
        'Health check failed',
        'database',
        undefined,
        expect.any(String),
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('should close the pool', async () => {
      mockPool.end.mockResolvedValue(undefined);
      await indicator.onModuleDestroy();
      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});
