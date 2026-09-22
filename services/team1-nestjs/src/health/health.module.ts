import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { LoggingModule } from '../logging/logging.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { KafkaHealthIndicator } from './indicators/kafka.indicator';

@Module({
  imports: [TerminusModule, LoggingModule],
  controllers: [HealthController],
  providers: [HealthService, DatabaseHealthIndicator, KafkaHealthIndicator],
})
export class HealthModule {}
