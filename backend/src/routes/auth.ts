import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { queryOne, run } from '../db/helpers';
import { z } from 'zod';
import { nanoid } from 'nanoid';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  twoFactorCode: z.string().optional(),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = registerSchema.parse(request.body);
    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [body.email]);
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(body.password, 12);
    const id = nanoid();
    await run('INSERT INTO users (id, email, phone, password_hash, display_name) VALUES ($1, $2, $3, $4, $5)',
      [id, body.email, body.phone || null, passwordHash, body.displayName]);
    const token = app.jwt.sign({ userId: id, email: body.email }, { expiresIn: '7d' });
    await run('INSERT INTO audit_logs (id, user_id, action, resource_type, ip_address) VALUES ($1, $2, $3, $4, $5)',
      [nanoid(), id, 'register', 'user', request.ip]);
    return reply.status(201).send({
      user: { id, email: body.email, displayName: body.displayName },
      token,
    });
  });

  app.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(request.body);
    const user: any = await queryOne(
      'SELECT id, email, display_name, password_hash, two_factor_secret, two_factor_enabled FROM users WHERE email = $1',
      [body.email]
    );
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
    const validPassword = await bcrypt.compare(body.password, user.password_hash);
    if (!validPassword) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
    if (user.two_factor_enabled) {
      if (!body.twoFactorCode) {
        return reply.status(200).send({ requiresTwoFactor: true });
      }
      const verified = speakeasy.totp.verify({
        secret: user.two_factor_secret,
        encoding: 'base32',
        token: body.twoFactorCode,
        window: 1,
      });
      if (!verified) {
        return reply.status(401).send({ error: 'Invalid 2FA code' });
      }
    }
    const token = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: '7d' });
    await run('INSERT INTO audit_logs (id, user_id, action, resource_type, ip_address) VALUES ($1, $2, $3, $4, $5)',
      [nanoid(), user.id, 'login', 'user', request.ip]);
    return reply.send({
      user: { id: user.id, email: user.email, displayName: user.display_name },
      token,
    });
  });

  app.get('/api/auth/me', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const user: any = await queryOne(
      'SELECT id, email, display_name, phone, avatar_url, two_factor_enabled, created_at FROM users WHERE id = $1',
      [userId]
    );
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    return reply.send({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      phone: user.phone,
      avatarUrl: user.avatar_url,
      twoFactorEnabled: !!user.two_factor_enabled,
      createdAt: user.created_at,
    });
  });

  app.post('/api/auth/2fa/enable', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const secret = speakeasy.generateSecret({ name: 'TripTogetherTracker' });
    await run('UPDATE users SET two_factor_secret = $1 WHERE id = $2', [secret.base32, userId]);
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);
    return reply.send({ secret: secret.base32, qrCode: qrCodeUrl });
  });

  app.post('/api/auth/2fa/verify', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { code } = request.body as { code: string };
    const user: any = await queryOne('SELECT two_factor_secret FROM users WHERE id = $1', [userId]);
    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });
    if (!verified) {
      return reply.status(400).send({ error: 'Invalid code' });
    }
    await run('UPDATE users SET two_factor_enabled = true WHERE id = $1', [userId]);
    return reply.send({ success: true });
  });

  app.post('/api/auth/2fa/disable', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    await run('UPDATE users SET two_factor_enabled = false, two_factor_secret = NULL WHERE id = $1', [userId]);
    return reply.send({ success: true });
  });
}
