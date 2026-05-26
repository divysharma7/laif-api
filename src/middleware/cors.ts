import cors from 'cors'
import { config } from '../config.js'

const origins = config.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)

export const corsMiddleware = cors({
  origin: config.NODE_ENV === 'development' ? true : origins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-request-id'],
})
