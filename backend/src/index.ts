import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import websocket from '@fastify/websocket';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import { closeDatabase, initDatabase, queryOne } from './db';
import { closeCache, initCache } from './db/cache';
import { registerErrorHandler } from './lib/errors';
import { unauthorized } from './lib/errors';
import { startRetentionJob, stopRetentionJob } from './lib/retention';
import authRoutes from './routes/auth';
import tripRoutes from './routes/trips';
import locationRoutes from './routes/locations';
import routingRoutes from './routes/routing';
import { setupWebSocket } from './websocket';
import { initMQTT } from './mqtt/handler';

async function buildServer() {
  const app = Fastify({
    logger: config.isProduction
      ? { level: 'info' }
      : { level: 'info', transport: undefined },
    trustProxy: config.isProduction,
    bodyLimit: 256 * 1024,
  });

  registerErrorHandler(app);

  await app.register(helmet, {
    // The API serves JSON and never renders HTML, so the strictest defaults apply.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(websocket);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
  });
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    // Credential and ingest routes set their own tighter budgets.
    keyGenerator: (request) => request.ip,
  });

  app.decorateRequest('currentUserId', '');

  app.decorate('authenticate', async function authenticate(request: any) {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized('Sign in to continue', 'AUTH_REQUIRED');
    }

    const payload = request.user as { userId: string; tv?: number };
    const user = await queryOne<{ token_version: number }>('SELECT token_version FROM users WHERE id = $1', [
      payload.userId,
    ]);
    // A bumped token_version (sign out everywhere, 2FA change) invalidates tokens that
    // have not expired yet.
    if (!user || (payload.tv ?? 0) !== (user.token_version ?? 0)) {
      throw unauthorized('Your session has expired, please sign in again', 'SESSION_EXPIRED');
    }
    request.currentUserId = payload.userId;
  });

  setupWebSocket(app);

  await app.register(authRoutes);
  await app.register(tripRoutes);
  await app.register(locationRoutes);
  await app.register(routingRoutes);

  app.get('/', async () => ({ name: 'Trip Tracker API', status: 'ok', health: '/api/health' }));
  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: config.usePostgres ? 'postgres' : 'sqlite',
    cache: config.REDIS_URL ? 'redis' : 'memory',
  }));

  return app;
}

async function main() {
  await initDatabase();
  await initCache();

  const app = await buildServer();
  initMQTT();
  startRetentionJob();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received, shutting down`);
    stopRetentionJob();
    try {
      await app.close();
      await closeCache();
      await closeDatabase();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`Trip Tracker API listening on http://${config.HOST}:${config.PORT}`);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
