import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CatalogController } from './catalog';

@Module({ controllers: [CatalogController] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  app.enableCors({ origin, methods: ['GET', 'POST', 'PUT'], maxAge: 600 });
  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
