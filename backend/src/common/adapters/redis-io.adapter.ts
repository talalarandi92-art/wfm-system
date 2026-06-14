import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

/**
 * Socket.io adapter backed by Redis pub/sub.
 *
 * With this adapter, chat presence and room membership are shared across every
 * backend instance and survive restarts — enabling horizontal scaling. If Redis
 * is unreachable (e.g. local dev without the container), it logs a warning and
 * silently falls back to the default in-memory adapter so chat still works.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private readonly logger = new Logger('RedisIoAdapter');

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;
    this.logger.log(`Configuring chat WebSocket transport (trying Redis ${host}:${port})...`);

    // connectTimeout bounds each attempt; reconnectStrategy fails fast (no retry
    // storm) so a down Redis can never stall backend startup. Once connected,
    // node-redis still auto-reconnects on transient drops within the timeout.
    const socket = { host, port, connectTimeout: 4000, reconnectStrategy: () => false as const };
    const pubClient = createClient({ socket, password });
    const subClient = pubClient.duplicate();
    // Prevent unhandled 'error' events from crashing the process
    pubClient.on('error', () => undefined);
    subClient.on('error', () => undefined);

    // Hard cap the whole attempt at 5s regardless of client internals.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('redis connect timeout')), 5000));

    try {
      await Promise.race([Promise.all([pubClient.connect(), subClient.connect()]), timeout]);
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log(`Chat socket.io using Redis adapter (${host}:${port})`);
    } catch {
      this.logger.warn(
        'Redis unavailable — chat using in-memory adapter (no cross-instance presence / no scaling). ' +
        'Set REDIS_HOST/REDIS_PORT/REDIS_PASSWORD and ensure Redis is running for production.',
      );
      try { pubClient.destroy(); } catch { /* ignore */ }
      try { subClient.destroy(); } catch { /* ignore */ }
    }
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
