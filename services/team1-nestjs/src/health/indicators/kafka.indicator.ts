import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { MultiFileLogger } from '../../logging/logger.service';

@Injectable()
export class KafkaHealthIndicator {
  private readonly broker: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject('KAFKA_LOGGER') private readonly logger: MultiFileLogger,
  ) {
    this.broker =
      this.configService.get<string>('app.kafka.broker') ?? 'localhost:9092';
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const [host, port] = this.broker.split(':');
      const net = await import('net');

      await new Promise<void>((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);

        socket.on('connect', () => {
          socket.destroy();
          resolve();
        });

        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error('Connection timeout'));
        });

        socket.on('error', (err) => {
          socket.destroy();
          reject(err);
        });

        socket.connect(parseInt(port, 10), host);
      });

      this.logger.logFromSource('kafka', 'log', 'Health check passed', key, {
        broker: this.broker,
      });

      return {
        [key]: {
          status: 'up',
          message: 'Kafka broker reachable',
          broker: this.broker,
        },
      };
    } catch (error) {
      this.logger.logFromSource(
        'kafka',
        'error',
        'Health check failed',
        key,
        { broker: this.broker },
        error.stack,
      );

      throw new HealthCheckError('Kafka health check failed', {
        [key]: {
          status: 'down',
          message: error.message,
          broker: this.broker,
        },
      });
    }
  }
}
