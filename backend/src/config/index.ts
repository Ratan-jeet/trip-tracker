import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  // Comma-separated list of allowed browser origins.
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().optional(),
  // strict: verify the server certificate (default, correct for managed Postgres).
  // no-verify: encrypt but skip verification (only for providers with self-signed certs).
  // off: no TLS at all (local development only).
  DATABASE_SSL: z.enum(['strict', 'no-verify', 'off']).default('strict'),
  SQLITE_PATH: z.string().optional(),

  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Routing is proxied through this server so member coordinates never reach a
  // third party directly from the browser. Point this at your own OSRM instance.
  OSRM_URL: z.string().url().default('https://router.project-osrm.org'),
  OSRM_TIMEOUT_MS: z.coerce.number().int().positive().default(6000),
  OSRM_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(20000),

  // Place search, proxied for the same reason as routing.
  GEOCODER_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  // Nominatim's usage policy requires a contact address in the User-Agent.
  GEOCODER_USER_AGENT: z.string().default('TripTracker/2.0 (self-hosted; set GEOCODER_USER_AGENT)'),

  LOCATION_EXPIRY_DAYS: z.coerce.number().int().positive().default(30),
  // A client clock may run ahead/behind; anything outside this window is clamped
  // to server time rather than trusted.
  LOCATION_FUTURE_SKEW_MIN: z.coerce.number().int().nonnegative().default(5),
  LOCATION_PAST_SKEW_MIN: z.coerce.number().int().nonnegative().default(1440),
  RETENTION_SWEEP_HOURS: z.coerce.number().int().positive().default(6),
  // Backstop for the 'once' and 'while_using' consent levels. A browser closed abruptly
  // cannot tell the server it stopped, so a member who has reported nothing for this long
  // has their sharing flag cleared server-side.
  SHARING_IDLE_MINUTES: z.coerce.number().int().positive().default(15),
  SHARING_SWEEP_SECONDS: z.coerce.number().int().positive().default(60),

  HISTORY_MAX_ROWS: z.coerce.number().int().positive().max(100_000).default(5_000),
  EXPORT_MAX_ROWS: z.coerce.number().int().positive().max(500_000).default(50_000),

  LIVE_STALE_MS: z.coerce.number().int().positive().default(120_000),
  LIVE_CACHE_TTL_SEC: z.coerce.number().int().positive().default(900),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${detail}`);
}

const env = parsed.data;
const isProduction = env.NODE_ENV === 'production';

// A JWT secret that changes between boots silently signs every user out and, worse,
// hides a missing deployment variable. Refuse to start instead.
if (isProduction && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error(
    'JWT_SECRET must be set to at least 32 characters when NODE_ENV=production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
  );
}

if (isProduction && !env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set when NODE_ENV=production (SQLite is for local development only).');
}

const DEV_JWT_SECRET = 'insecure-development-only-secret-do-not-use-in-production';

/**
 * Render's `fromService` wiring yields a bare host ("trip-tracker-web.onrender.com"),
 * but CORS compares full origins, so a bare host silently matches nothing and every
 * browser request fails. Add the scheme rather than making that a deploy-time footgun.
 */
function normaliseOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Anything that is not obviously local gets https.
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(trimmed);
  return `${isLocal ? 'http' : 'https'}://${trimmed}`;
}

export const config = {
  ...env,
  isProduction,
  isDevelopment: env.NODE_ENV === 'development',
  JWT_SECRET: env.JWT_SECRET ?? DEV_JWT_SECRET,
  corsOrigins: env.CORS_ORIGIN.split(',').map(normaliseOrigin).filter(Boolean),
  usePostgres: !!env.DATABASE_URL,
};

export type Config = typeof config;
