import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CatalogController } from './catalog';
import { Work24Controller } from './work24';

@Module({ controllers: [CatalogController, Work24Controller] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const server = app.getHttpAdapter().getInstance();
  server.disable('x-powered-by');
  server.use((_request: unknown, response: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  app.enableCors({ origin, methods: ['GET', 'POST', 'PUT'], maxAge: 600 });
  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
