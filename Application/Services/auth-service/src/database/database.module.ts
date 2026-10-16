import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

function sslFor(mode: string | undefined) {
  // PGSSLMODE comes from k8s/base/config.env (no-verify in the cluster because
  // RDS's CA is not in Node's trust store). Absent locally -> no SSL.
  const m = (mode || '').trim().toLowerCase();
  if (m === '' || m === 'disable') {
    return undefined;
  }
  if (m === 'no-verify' || m === 'require' || m === 'prefer') {
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

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
          ssl: sslFor(process.env.PGSSLMODE),
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [Pool],
})
export class DatabaseModule {}
