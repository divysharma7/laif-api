import type { Request, Response, NextFunction } from 'express'
import { verifyToken, COOKIE_NAME } from '../lib/auth.js'
import { config } from '../config.js'
import { logger } from '../lib/logger.js'

const PUBLIC_PREFIXES = [
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/posthook_listener',
  '/api/devices/register',
  '/api/alexa',
]

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
}

function resolveToken(req: Request): string | undefined {
  // 1. Cookie
  const cookieToken = req.cookies?.[COOKIE_NAME]
  if (cookieToken) return cookieToken

  // 2. Bearer
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim()
    if (bearer) return bearer
  }

  // 3. x-api-key
  const apiKey = req.headers['x-api-key']
  if (typeof apiKey === 'string' && apiKey) return apiKey

  return undefined
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isPublic(req.path)) {
    // Dev fallback for public routes too
    if (config.NODE_ENV === 'development' && config.DEV_USER_ID) {
      req.userId = config.DEV_USER_ID
    }
    return next()
  }

  const token = resolveToken(req)

  if (!token) {
    if (config.NODE_ENV === 'development' && config.DEV_USER_ID) {
      req.userId = config.DEV_USER_ID
      logger.debug({ path: req.path }, 'Dev auth bypass')
      return next()
    }
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const payload = await verifyToken(token)
    req.userId = payload.userId
    next()
  } catch {
    if (config.NODE_ENV === 'development' && config.DEV_USER_ID) {
      req.userId = config.DEV_USER_ID
      return next()
    }
    res.status(401).json({ error: 'Unauthorized' })
  }
}
