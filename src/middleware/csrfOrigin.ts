import type { Request, Response, NextFunction } from 'express'
import { config } from '../config.js'
import { COOKIE_NAME } from '../lib/auth.js'

const allowedOrigins = new Set(
  config.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean),
)
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

export function csrfOriginMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (safeMethods.has(req.method) || !req.cookies?.[COOKIE_NAME]) {
    next()
    return
  }

  const origin = req.headers.origin
  if (!origin || allowedOrigins.has(origin)) {
    next()
    return
  }

  res.status(403).json({ error: 'Origin not allowed' })
}
