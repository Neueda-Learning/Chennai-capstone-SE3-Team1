import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  constructor(private readonly configService: ConfigService) {}

  getInfo() {
    return {
      name: 'Team 1 NestJS Trading Service',
      version: '1.0.0',
      environment: this.configService.get('NODE_ENV', 'development'),
      timestamp: new Date().toISOString(),
    };
  }
}
