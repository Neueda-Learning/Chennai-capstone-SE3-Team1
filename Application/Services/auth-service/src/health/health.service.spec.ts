import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { KafkaHealthIndicator } from './indicators/kafka.indicator';
import { HealthIndicatorResult } from '@nestjs/terminus';

describe('HealthService', () => {
  let service: HealthService;
  let databaseIndicator: jest.Mocked<DatabaseHealthIndicator>;
  let kafkaIndicator: jest.Mocked<KafkaHealthIndicator>;

  const mockHealthyResult: HealthIndicatorResult = {
    database: { status: 'up', message: 'Database connection successful' },
  };

  const mockKafkaResult: HealthIndicatorResult = {
    kafka: {
      status: 'up',
      message: 'Kafka broker reachable',
      broker: 'localhost:9092',
    },
  };

  beforeEach(async () => {
    databaseIndicator = {
      isHealthy: jest.fn(),
    } as any;

    kafkaIndicator = {
      isHealthy: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: DatabaseHealthIndicator, useValue: databaseIndicator },
        { provide: KafkaHealthIndicator, useValue: kafkaIndicator },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  describe('isHealthy', () => {
    it('should return healthy for liveness probe', async () => {
      databaseIndicator.isHealthy.mockResolvedValue(mockHealthyResult);

      const result = await service.isHealthy('liveness');

      expect(result).toEqual({
        team1_nestjs: { status: 'up' },
        database: { status: 'up', message: 'Database connection successful' },
      });
      expect(databaseIndicator.isHealthy).toHaveBeenCalledWith('database');
      expect(kafkaIndicator.isHealthy).not.toHaveBeenCalled();
    });

    it('should check database and kafka for readiness', async () => {
      databaseIndicator.isHealthy.mockResolvedValue(mockHealthyResult);
      kafkaIndicator.isHealthy.mockResolvedValue(mockKafkaResult);

      const result = await service.isHealthy('readiness');

      expect(result).toEqual({
        team1_nestjs: { status: 'up' },
        database: { status: 'up', message: 'Database connection successful' },
        kafka: {
          status: 'up',
          message: 'Kafka broker reachable',
          broker: 'localhost:9092',
        },
      });
      expect(databaseIndicator.isHealthy).toHaveBeenCalledWith('database');
      expect(kafkaIndicator.isHealthy).toHaveBeenCalledWith('kafka');
    });

    it('should check database and kafka for startup', async () => {
      databaseIndicator.isHealthy.mockResolvedValue(mockHealthyResult);
      kafkaIndicator.isHealthy.mockResolvedValue(mockKafkaResult);

      const result = await service.isHealthy('startup');

      expect(result).toEqual({
        team1_nestjs: { status: 'up' },
        database: { status: 'up', message: 'Database connection successful' },
        kafka: {
          status: 'up',
          message: 'Kafka broker reachable',
          broker: 'localhost:9092',
        },
      });
      expect(databaseIndicator.isHealthy).toHaveBeenCalledWith('database');
      expect(kafkaIndicator.isHealthy).toHaveBeenCalledWith('kafka');
    });

    it('should throw HealthCheckError when database is unhealthy', async () => {
      databaseIndicator.isHealthy.mockRejectedValue(
        new Error('Health check failed'),
      );

      await expect(service.isHealthy('liveness')).rejects.toThrow();
    });
  });
});
