import express from 'express'
import cookieParser from 'cookie-parser'
import pinoHttp from 'pino-http'
import { logger } from './lib/logger.js'
import { corsMiddleware } from './middleware/cors.js'
import { requestIdMiddleware } from './middleware/requestId.js'
import { generalLimiter } from './middleware/rateLimiter.js'
import { authMiddleware } from './middleware/auth.js'
import { csrfOriginMiddleware } from './middleware/csrfOrigin.js'
import { errorHandler } from './middleware/errorHandler.js'
import { routes } from './routes/index.js'

export function createApp() {
  const app = express()

  // ── Middleware stack ──
  app.use(requestIdMiddleware)
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }))
  app.use(corsMiddleware)
  app.use(express.json({ limit: '5mb' }))
  app.use(cookieParser())
  app.use(csrfOriginMiddleware)
  app.use(generalLimiter)

  // ── Health check ──
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }) })
  app.use(authMiddleware)

  // ── Routes (mounted at /api and /api/v1 for backward compat) ──
  app.use('/api/v1', routes)
  app.use('/api', routes)

  // ── Error handler (must be last) ──
  app.use(errorHandler)

  return app
}
