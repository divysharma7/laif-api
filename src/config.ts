import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(1),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.string().default('info'),
  DEV_USER_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(5),
  OPENROUTER_API_KEY: z.string().optional(),
})

export const config = envSchema.parse(process.env)
