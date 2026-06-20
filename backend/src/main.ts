import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import * as compression from 'compression';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('APP_PORT', 3000);
  const corsOrigins = config.get<string>('CORS_ORIGINS', 'http://localhost:5173');

  // Security headers — helmet defaults (nosniff, frameguard=SAMEORIGIN, hidePoweredBy …)
  // plus an explicit referrer policy and HSTS in production. CSP stays off because the
  // SPA + Swagger UI use inline styles/scripts; enable a tuned CSP before public exposure.
  const isProd = config.get('NODE_ENV') === 'production';
  app.use(helmet({
    // In prod the only HTML this server emits is the outage share report
    // (same-origin styles/images + Google Fonts, no inline scripts), so a tuned
    // CSP is safe. In dev it stays off because Swagger UI needs inline/eval.
    contentSecurityPolicy: isProd ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
        imgSrc:     ["'self'", 'data:'],
        objectSrc:  ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));

  // CORS — whitelist only
  app.enableCors({
    origin: corsOrigins.split(',').map(o => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Slug'],
  });

  // Request body limits — 50 MB for file uploads / Sprinklr payloads
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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

  // Serve uploaded files (outage attachments, etc.)
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir, {
    // Never let the browser MIME-sniff an uploaded file into something executable,
    // and force download semantics for anything that isn't an inline-safe media type.
    setHeaders: (res, filePath) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (!/\.(jpg|jpeg|png|gif|webp|svg|mp4|mov|webm|pdf)$/i.test(filePath)) {
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
  }));

  // Chat WebSocket — Redis adapter (falls back to in-memory if Redis is down)
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // Graceful shutdown
  app.enableShutdownHooks();

  await app.listen(port);
  console.log(`WFM Backend running on http://localhost:${port}`);
  console.log(`Swagger docs:       http://localhost:${port}/api/docs`);
}

bootstrap();

