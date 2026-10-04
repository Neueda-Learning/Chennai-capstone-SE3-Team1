import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { KafkaHealthIndicator } from './indicators/kafka.indicator';

type ProbeType = 'liveness' | 'readiness' | 'startup';

@Injectable()
export class HealthService {
  constructor(
    private readonly databaseIndicator: DatabaseHealthIndicator,
    private readonly kafkaIndicator: KafkaHealthIndicator,
  ) {}

  async isHealthy(probe: ProbeType): Promise<HealthIndicatorResult> {
    const checks: Promise<HealthIndicatorResult>[] = [];

    if (probe === 'liveness') {
      // Liveness only checks if the process is alive
      checks.push(this.databaseIndicator.isHealthy('database'));
    }

    if (probe === 'readiness' || probe === 'startup') {
      // Readiness and startup check all dependencies
      checks.push(this.databaseIndicator.isHealthy('database'));
      checks.push(this.kafkaIndicator.isHealthy('kafka'));
    }

    try {
      const results = await Promise.all(checks);
      const combined: HealthIndicatorResult = {
        team1_nestjs: { status: 'up' },
      };

      for (const result of results) {
        Object.assign(combined, result);
      }

      return combined;
    } catch (error) {
      throw new HealthCheckError('Health check failed', error);
    }
  }
}
