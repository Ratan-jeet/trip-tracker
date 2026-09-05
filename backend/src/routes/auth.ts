import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { z } from 'zod';
import { queryOne, run } from '../db';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';
import { toUser } from '../lib/mappers';

// bcryptjs is pure JavaScript: a 12-round hash blocked the event loop for hundreds of
// milliseconds, so every login stalled the whole server. The native binding runs the
// work on libuv's threadpool instead.
const BCRYPT_ROUNDS = 12;
const RECOVERY_CODE_COUNT = 8;

/**
 * A bcrypt hash of a value nothing can match, compared against when no user row exists so
 * that a miss costs the same as a hit. Without it, an unknown address answered in about a
 * millisecond and a known one in a hundred, which is a usable account-existence oracle.
 * Computed once at startup.
 */
const DUMMY_HASH = bcrypt.hashSync('trip-tracker::no-such-account', BCRYPT_ROUNDS);

// Accept the adjacent 30-second steps so a slightly skewed phone clock still works.
authenticator.options = { window: 1 };

const registerSchema = z.object({
  email: z.string().email().max(255).transform((e) => e.trim().toLowerCase()),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(255).transform((e) => e.trim().toLowerCase()),
  password: z.string().min(1).max(200),
  twoFactorCode: z.string().trim().max(20).optional(),
  recoveryCode: z.string().trim().max(40).optional(),
});

const passwordConfirmSchema = z.object({
  password: z.string().min(1).max(200),
});

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  two_factor_secret: string | null;
  two_factor_pending_secret: string | null;
  two_factor_enabled: boolean | number;
  two_factor_recovery_codes: string | null;
  token_version: number;
}

function signToken(app: FastifyInstance, user: { id: string; email: string; token_version: number }): string {
  // `tv` lets a user invalidate every outstanding token (sign out everywhere, 2FA change)
  // without waiting for the 7-day expiry.
  return app.jwt.sign({ userId: user.id, email: user.email, tv: user.token_version ?? 0 });
}

async function generateRecoveryCodes(): Promise<{ plain: string[]; hashed: string }> {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = newId().replace(/[-_]/g, '').slice(0, 10).toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
  const hashed = await Promise.all(plain.map((code) => bcrypt.hash(code, 10)));
  return { plain, hashed: JSON.stringify(hashed) };
}

async function consumeRecoveryCode(user: UserRow, candidate: string): Promise<boolean> {
  if (!user.two_factor_recovery_codes) return false;
  let hashes: string[];
  try {
    hashes = JSON.parse(user.two_factor_recovery_codes);
  } catch {
    return false;
  }

  const normalised = candidate.trim().toUpperCase();
  for (let i = 0; i < hashes.length; i += 1) {
    if (await bcrypt.compare(normalised, hashes[i])) {
      hashes.splice(i, 1); // single use
      await run('UPDATE users SET two_factor_recovery_codes = $1, updated_at = $2 WHERE id = $3', [
        JSON.stringify(hashes),
        nowIso(),
        user.id,
      ]);
      return true;
    }
  }
  return false;
}

/** Re-authentication for changes that weaken account security. */
async function verifyPassword(user: UserRow, password: string): Promise<void> {
  if (!(await bcrypt.compare(password, user.password_hash))) {
    throw forbidden('Password is incorrect', 'BAD_PASSWORD');
  }
}

async function loadUser(userId: string): Promise<UserRow> {
  const user = await queryOne<UserRow>(
    `SELECT id, email, display_name, password_hash, two_factor_secret, two_factor_pending_secret,
            two_factor_enabled, two_factor_recovery_codes, token_version
       FROM users WHERE id = $1`,
    [userId],
  );
  if (!user) throw unauthorized('User not found', 'USER_NOT_FOUND');
  return user;
}

export default async function authRoutes(app: FastifyInstance) {
  // Credential endpoints get their own budget. Under the previous global 200/minute a
  // single IP could try 200 passwords a minute against any account.
  const credentialLimit = {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  };

  app.post('/api/auth/register', credentialLimit, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = registerSchema.parse(request.body);

    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [body.email]);
    if (existing) throw conflict('Email already registered', 'EMAIL_TAKEN');

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    const id = newId();
    const now = nowIso();

    await run(
      `INSERT INTO users (id, email, phone, password_hash, display_name, two_factor_enabled, token_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, body.email, body.phone || null, passwordHash, body.displayName, false, 0, now, now],
    );

    await audit({ userId: id, action: 'register', resourceType: 'user', resourceId: id, request });

    return reply.status(201).send({
      user: { id, email: body.email, displayName: body.displayName, twoFactorEnabled: false },
      token: signToken(app, { id, email: body.email, token_version: 0 }),
    });
  });

  app.post('/api/auth/login', credentialLimit, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(request.body);
    const user = await queryOne<UserRow>(
      `SELECT id, email, display_name, password_hash, two_factor_secret, two_factor_pending_secret,
              two_factor_enabled, two_factor_recovery_codes, token_version
         FROM users WHERE email = $1`,
      [body.email],
    );

    // Always spend the same work, whether or not the address is registered.
    const passwordOk = await bcrypt.compare(body.password, user?.password_hash ?? DUMMY_HASH);

    if (!user || !passwordOk) {
      if (user) {
        await audit({ userId: user.id, action: 'login_failed', resourceType: 'user', resourceId: user.id, request });
      }
      throw unauthorized('Invalid email or password', 'BAD_CREDENTIALS');
    }

    if (user.two_factor_enabled) {
      if (!body.twoFactorCode && !body.recoveryCode) {
        return reply.send({ requiresTwoFactor: true });
      }

      const accepted = body.recoveryCode
        ? await consumeRecoveryCode(user, body.recoveryCode)
        : !!user.two_factor_secret &&
          authenticator.verify({ token: body.twoFactorCode!.replace(/\s/g, ''), secret: user.two_factor_secret });

      if (!accepted) {
        await audit({ userId: user.id, action: 'login_failed', resourceType: 'user', resourceId: user.id, request });
        throw unauthorized('Invalid two-factor code', 'BAD_2FA_CODE');
      }
    }

    await audit({ userId: user.id, action: 'login', resourceType: 'user', resourceId: user.id, request });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        twoFactorEnabled: !!user.two_factor_enabled,
      },
      token: signToken(app, user),
    });
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const user = await queryOne<any>(
      `SELECT id, email, display_name, phone, avatar_url, two_factor_enabled, created_at
         FROM users WHERE id = $1`,
      [userId],
    );
    if (!user) throw unauthorized('User not found', 'USER_NOT_FOUND');

    return toUser(user);
  });

  /**
   * Starting 2FA setup requires the password. Without that check a stolen token was
   * enough to overwrite the secret of an account that already had 2FA enabled, quietly
   * moving the second factor to a device the attacker controls.
   */
  app.post(
    '/api/auth/2fa/enable',
    { preHandler: [app.authenticate], ...credentialLimit },
    async (request: FastifyRequest) => {
      const body = passwordConfirmSchema.parse(request.body);
      const user = await loadUser(request.currentUserId);
      await verifyPassword(user, body.password);

      const secret = authenticator.generateSecret();
      const otpauth = authenticator.keyuri(user.email, 'Trip Tracker', secret);

      // Written to the pending column, so an authenticator that is already protecting
      // this account keeps working until the new one has proven itself in /2fa/verify.
      // Writing straight to two_factor_secret meant an abandoned re-enrolment silently
      // invalidated the live authenticator while two_factor_enabled stayed true —
      // locking the account to its recovery codes.
      await run('UPDATE users SET two_factor_pending_secret = $1, updated_at = $2 WHERE id = $3', [
        secret,
        nowIso(),
        user.id,
      ]);

      return { secret, otpauthUrl: otpauth, qrCode: await QRCode.toDataURL(otpauth) };
    },
  );

  app.post(
    '/api/auth/2fa/verify',
    { preHandler: [app.authenticate], ...credentialLimit },
    async (request: FastifyRequest) => {
      const { code } = z.object({ code: z.string().trim().min(6).max(10) }).parse(request.body);
      const user = await loadUser(request.currentUserId);

      // Previously this dereferenced a null secret and answered 500 when setup was skipped.
      if (!user.two_factor_pending_secret) {
        throw badRequest('Start two-factor setup before verifying a code', 'NO_PENDING_2FA');
      }
      if (!authenticator.verify({ token: code.replace(/\s/g, ''), secret: user.two_factor_pending_secret })) {
        throw badRequest('That code is not valid', 'BAD_2FA_CODE');
      }

      // Proven: promote the pending secret to the live one and clear the pending slot.
      const { plain, hashed } = await generateRecoveryCodes();
      await run(
        `UPDATE users SET two_factor_secret = $1, two_factor_pending_secret = NULL, two_factor_enabled = $2,
                two_factor_recovery_codes = $3, token_version = token_version + 1, updated_at = $4
           WHERE id = $5`,
        [user.two_factor_pending_secret, true, hashed, nowIso(), user.id],
      );

      await audit({ userId: user.id, action: '2fa_enabled', resourceType: 'user', resourceId: user.id, request });

      // Shown once. Sessions elsewhere are invalidated by the token_version bump.
      return { success: true, recoveryCodes: plain };
    },
  );

  /** Turning 2FA off needs the password *and* a current code — a token alone is not enough. */
  app.post(
    '/api/auth/2fa/disable',
    { preHandler: [app.authenticate], ...credentialLimit },
    async (request: FastifyRequest) => {
      const body = passwordConfirmSchema
        .extend({ code: z.string().trim().min(6).max(40) })
        .parse(request.body);
      const user = await loadUser(request.currentUserId);
      await verifyPassword(user, body.password);

      const accepted =
        (!!user.two_factor_secret &&
          authenticator.verify({ token: body.code.replace(/\s/g, ''), secret: user.two_factor_secret })) ||
        (await consumeRecoveryCode(user, body.code));
      if (!accepted) throw badRequest('That code is not valid', 'BAD_2FA_CODE');

      await run(
        `UPDATE users SET two_factor_enabled = $1, two_factor_secret = NULL, two_factor_pending_secret = NULL,
                two_factor_recovery_codes = NULL, token_version = token_version + 1, updated_at = $2
           WHERE id = $3`,
        [false, nowIso(), user.id],
      );

      await audit({ userId: user.id, action: '2fa_disabled', resourceType: 'user', resourceId: user.id, request });
      return { success: true };
    },
  );

  /** Invalidates every JWT issued to this account, including the caller's. */
  app.post('/api/auth/logout-all', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    await run('UPDATE users SET token_version = token_version + 1, updated_at = $1 WHERE id = $2', [
      nowIso(),
      request.currentUserId,
    ]);
    await audit({
      userId: request.currentUserId,
      action: 'logout_all',
      resourceType: 'user',
      resourceId: request.currentUserId,
      request,
    });
    return { success: true };
  });
}
