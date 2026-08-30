import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('dev-secret-change-in-production-xxxxxxxx'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  MQTT_BROKER_URL: z.string().optional(),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MAPBOX_ACCESS_TOKEN: z.string().optional(),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOCATION_EXPIRY_DAYS: z.coerce.number().default(30),
});

export const config = envSchema.parse(process.env);
