import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { initDatabase, queryOne, run, closeDatabase } from './db/helpers';
import authRoutes from './routes/auth';
import tripRoutes from './routes/trips';
import locationRoutes from './routes/locations';
import { setupWebSocket, broadcastToTrip } from './websocket';
import { initMQTT } from './mqtt/handler';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';

const PORT = parseInt(process.env.PORT || '3001');
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production-' + nanoid(16);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

async function main() {
  await initDatabase();

  const app = Fastify({ logger: { level: 'info' } });

  await app.register(cors, { origin: CORS_ORIGIN, credentials: true });
  await app.register(websocket);
  await app.register(jwt, { secret: JWT_SECRET, sign: { expiresIn: '7d' } });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });

  app.decorate('authenticate', async function (request: any, reply: any) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  setupWebSocket(app);
  await app.register(authRoutes);
  await app.register(tripRoutes);
  await app.register(locationRoutes);

  app.get('/', async () => ({ name: 'Trip Tracker API', status: 'ok', docs: '/api/health' }));
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  await seedDemoData();

  initMQTT((tripId, deviceId, data) => {
    broadcastToTrip(tripId, { type: 'location_update', deviceId, ...data });
  });

  const shutdown = async () => {
    console.log('\nShutting down...');
    await app.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`\n  Trip Tracker API running on http://${HOST}:${PORT}\n`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

async function seedDemoData() {
  const existing = await queryOne('SELECT id FROM users LIMIT 1');
  if (existing) return;

  const passwordHash = await bcrypt.hash('password123', 12);
  const aliceId = nanoid();
  const bobId = nanoid();

  await run('INSERT INTO users (id, email, password_hash, display_name, phone) VALUES ($1, $2, $3, $4, $5)',
    [aliceId, 'alice@example.com', passwordHash, 'Alice', '+1234567890']);
  await run('INSERT INTO users (id, email, password_hash, display_name, phone) VALUES ($1, $2, $3, $4, $5)',
    [bobId, 'bob@example.com', passwordHash, 'Bob', '+0987654321']);

  const tripId = nanoid();
  const inviteCode = nanoid(8).toUpperCase();

  await run('INSERT INTO trips (id, name, description, invite_code, creator_id) VALUES ($1, $2, $3, $4, $5)',
    [tripId, 'Goa Trip 2024', 'Annual friends trip to Goa', inviteCode, aliceId]);
  await run('INSERT INTO trip_members (id, trip_id, user_id, role, is_sharing, consent_given, consent_level) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [nanoid(), tripId, aliceId, 'admin', true, true, 'always']);
  await run('INSERT INTO trip_members (id, trip_id, user_id, role, is_sharing, consent_given, consent_level) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [nanoid(), tripId, bobId, 'member', true, true, 'always']);
  await run('INSERT INTO devices (id, user_id, trip_id, device_type, name) VALUES ($1, $2, $3, $4, $5)',
    [nanoid(), aliceId, tripId, 'phone', "Alice's Phone"]);
  await run('INSERT INTO devices (id, user_id, trip_id, device_type, name) VALUES ($1, $2, $3, $4, $5)',
    [nanoid(), bobId, tripId, 'phone', "Bob's Phone"]);

  console.log(`  Demo accounts:`);
  console.log(`    alice@example.com / password123`);
  console.log(`    bob@example.com   / password123`);
  console.log(`  Demo trip invite code: ${inviteCode}\n`);
}

main();
