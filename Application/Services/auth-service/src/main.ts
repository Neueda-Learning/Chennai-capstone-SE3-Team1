import './config/load-env';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('app.port');
  const baseUrl = configService.getOrThrow<string>('app.baseUrl');

  app.enableCors();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Auth service')
    .setDescription(
      'Registration, login, token refresh, logout and current-user lookup. ' +
        'Serves contracts/auth-api.yaml.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/json',
  });

  await app.listen(port);
  console.log(`Application is running on: ${baseUrl}`);
  console.log(`Health check available at: ${baseUrl}/health`);
  console.log(`OpenAPI docs at: ${baseUrl}/docs`);
  console.log(`OpenAPI JSON at: ${baseUrl}/docs/json`);
}

bootstrap();
