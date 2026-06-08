import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import * as compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('APP_PORT', 3000);
  const corsOrigins = config.get<string>('CORS_ORIGINS', 'http://localhost:5173');

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false, // Disable for Swagger UI in dev
  }));

  // CORS — whitelist only
  app.enableCors({
    origin: corsOrigins.split(',').map(o => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Slug'],
  });

  // Request body limits
  app.use(compression());
  app.use(cookieParser());

  // Global validation pipe — strip unknown fields, transform types
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // API prefix and versioning
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Swagger (dev only)
  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('WFM Platform API')
      .setDescription('Boutiqaat Contact Center Workforce Management Platform')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Graceful shutdown
  app.enableShutdownHooks();

  await app.listen(port);
  console.log(`WFM Backend running on http://localhost:${port}`);
  console.log(`Swagger docs:       http://localhost:${port}/api/docs`);
}

bootstrap();
