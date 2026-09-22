import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { Pool } from 'pg';
import { MultiFileLogger } from '../../logging/logger.service';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly pool: Pool,
    @Inject('DATABASE_LOGGER') private readonly logger: MultiFileLogger,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();

      this.logger.logFromSource('database', 'log', 'Health check passed', key);

      return {
        [key]: {
          status: 'up',
          message: 'Database connection successful',
        },
      };
    } catch (error) {
      this.logger.logFromSource(
        'database',
        'error',
        'Health check failed',
        key,
        undefined,
        error.stack,
      );

      throw new HealthCheckError('Database health check failed', {
        [key]: {
          status: 'down',
          message: error.message,
        },
      });
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
