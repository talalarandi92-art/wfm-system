import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
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

// ── Production secret guard (2026-07-12, risk study finding #16) ──────────────
// Refuse to boot in PRODUCTION with a placeholder / weak JWT signing secret. The
// dev .env ships secrets ending "_change_in_production"; if one of those ever
// reaches a real server the token-signing key is effectively public and anyone
// can forge a valid session. This ONLY fires when NODE_ENV==='production' —
// development (NODE_ENV=development or unset) is never affected, so the current
// local run is untouched. It reads process.env directly and runs before
// NestFactory/DB init, so a misconfigured prod fails fast and loud instead of
// coming up silently insecure.
function assertProductionSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return; // dev/test: never blocks boot
  const problems: string[] = [];
  const check = (name: string) => {
    const v = process.env[name];
    if (!v || v.trim() === '') problems.push(`${name} is missing / empty`);
    else if (v.includes('change_in_production')) problems.push(`${name} still holds the placeholder value (contains "change_in_production")`);
    else if (v.length < 32) problems.push(`${name} is too short (${v.length} chars; use >= 32 random chars)`);
  };
  check('JWT_ACCESS_SECRET');
  check('JWT_REFRESH_SECRET');
  if (problems.length) {
    throw new Error(
      'Refusing to start: production requires strong JWT secrets.\n  - ' +
        problems.join('\n  - ') +
        '\nGenerate values with `openssl rand -hex 64` (a different one per secret) and set them ' +
        'in the environment before deploying. See deploy/prod.env.example.',
    );
  }
}

async function bootstrap() {
  // Fail fast BEFORE any Nest/DB init if prod is configured with weak secrets.
  assertProductionSecrets();

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

  // Behind nginx/reverse-proxy: honor X-Forwarded-For so req.ip is the real client
  // (2026-07-06, risk #15 — without this, IP tracking sees ONE ip for the whole office).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

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

  // ── Serve the built SPA (single-origin — no Vite dev server needed) ────────
  // The frontend calls the API with the RELATIVE base '/api/v1', so serving it
  // from THIS same origin means one process, one port, no proxy. Static assets
  // come from frontend/dist; every non-API GET falls back to index.html so
  // client-side routes (deep links + refresh) work. All middleware here is
  // registered BEFORE app.listen(), so it runs ahead of the Nest router — the
  // fallback passes /api, /uploads and /socket.io straight through untouched.
  const frontendDist =
    config.get<string>('FRONTEND_DIST') ||
    path.join(process.cwd(), '..', 'frontend', 'dist');
  if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
    app.use(express.static(frontendDist, { index: false, maxAge: '1h' }));
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const p = req.path;
      if (p.startsWith('/api') || p.startsWith('/uploads') || p.startsWith('/socket.io')) return next();
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
    console.log(`Serving SPA from ${frontendDist}`);
  } else {
    console.warn(`SPA build not found at ${frontendDist} — run "npm run build" in frontend/ to enable single-origin serving.`);
  }

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

// ── Crash safety (2026-07-12, risk study) ────────────────────────────────────
// Fail fast, loudly, and deterministically so a process supervisor (systemd /
// pm2 / Docker restart:always) can bring the service back up. A swallowed error
// leaves the process alive-but-broken (silent downtime); exiting non-zero is the
// signal the supervisor needs to restart.
const bootstrapLogger = new Logger('Bootstrap');

// An unhandled promise rejection or a truly uncaught exception means the app is
// in an unknown, unsafe state — do NOT try to limp along. Log the full error and
// exit non-zero for a clean supervised restart.
process.on('unhandledRejection', (reason: unknown) => {
  bootstrapLogger.error('Unhandled promise rejection — exiting for supervised restart', reason instanceof Error ? reason.stack : String(reason));
  process.exit(1);
});
process.on('uncaughtException', (err: Error) => {
  bootstrapLogger.error('Uncaught exception — exiting for supervised restart', err.stack);
  process.exit(1);
});

bootstrap().catch((err) => {
  // A transient DB blip (or any error) during boot must not leave a dead, silent
  // process — surface it clearly and exit non-zero so the supervisor restarts us.
  bootstrapLogger.error('Fatal error during bootstrap — exiting for supervised restart', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});

