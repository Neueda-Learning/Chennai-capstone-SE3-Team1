import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { ConfigService } from '@nestjs/config';

describe('AppService', () => {
  let service: AppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const values: Record<string, any> = {
                NODE_ENV: 'test',
                PORT: 3000,
              };
              return values[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getInfo', () => {
    it('should return application info', () => {
      const result = service.getInfo();

      expect(result).toEqual({
        name: 'Team 1 NestJS Trading Service',
        version: '1.0.0',
        environment: 'test',
        timestamp: expect.any(String),
      });
    });

    it('should return valid ISO timestamp', () => {
      const result = service.getInfo();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });
});
