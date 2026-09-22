import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { Pool } from 'pg';
import { MultiFileLogger } from '../../logging/logger.service';

@Injectable()
export class DatabaseHealthIndicator {
  private pool: Pool;

  constructor(
    private readonly configService: ConfigService,
    @Inject('DATABASE_LOGGER') private readonly logger: MultiFileLogger,
  ) {
    this.pool = new Pool({
      host: this.configService.get('app.database.host'),
      port: this.configService.get('app.database.port'),
      user: this.configService.get('app.database.username'),
      password: this.configService.get('app.database.password'),
      database: this.configService.get('app.database.name'),
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 3000,
    });
  }

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
