import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

@Global()
@Module({
  providers: [
    {
      provide: Pool,
      useFactory: (configService: ConfigService) => {
        return new Pool({
          host: configService.get('app.database.host'),
          port: configService.get('app.database.port'),
          user: configService.get('app.database.username'),
          password: configService.get('app.database.password'),
          database: configService.get('app.database.name'),
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [Pool],
})
export class DatabaseModule {}
