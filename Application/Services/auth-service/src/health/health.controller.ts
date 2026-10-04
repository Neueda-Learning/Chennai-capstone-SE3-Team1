import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
} from '@nestjs/terminus';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly healthService: HealthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  @ApiResponse({ status: 503, description: 'Service is not healthy' })
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    return this.healthCheckService.check([
      () => this.healthService.isHealthy('liveness'),
    ]);
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service is not ready' })
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    return this.healthCheckService.check([
      () => this.healthService.isHealthy('readiness'),
    ]);
  }

  @Get('startup')
  @ApiOperation({ summary: 'Startup probe' })
  @ApiResponse({ status: 200, description: 'Service has started' })
  @ApiResponse({ status: 503, description: 'Service is still starting' })
  @HealthCheck()
  async startup(): Promise<HealthCheckResult> {
    return this.healthCheckService.check([
      () => this.healthService.isHealthy('startup'),
    ]);
  }
}
