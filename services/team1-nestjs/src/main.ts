import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  app.enableCors();

  // const swaggerConfig = new DocumentBuilder()
  //   .setTitle('Auth service')
  //   .setDescription(
  //     'Registration, login, token refresh, logout and current-user lookup. ' +
  //       'Serves contracts/auth-api.yaml.',
  //   )
  //   .setVersion('1.0.0')
  //   .addBearerAuth()
  //   .build();
  // const document = SwaggerModule.createDocument(app, swaggerConfig);
  // SwaggerModule.setup('docs', app, document, {
  //   jsonDocumentUrl: 'docs/json',
  // });

  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Health check available at: http://localhost:${port}/health`);
  console.log(`OpenAPI docs at: http://localhost:${port}/docs`);
  console.log(`OpenAPI JSON at: http://localhost:${port}/docs/json`);
}

bootstrap();
