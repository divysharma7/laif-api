import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.string().default('info'),
  DEV_USER_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_EMAIL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  POSTHOOK_API_KEY: z.string().optional(),
})

export const config = envSchema.parse(process.env)
export type Config = z.infer<typeof envSchema>
