import { Router, type Request, type Response, type NextFunction } from 'express'
import bcryptjs from 'bcryptjs'
import { signToken, COOKIE_NAME } from '../lib/auth.js'
import { config } from '../config.js'
import { getPrisma } from '../lib/prisma.js'
import { authLimiter } from '../middleware/rateLimiter.js'
import { logger } from '../lib/logger.js'

const { compare, hash } = bcryptjs
const router = Router()

const cookieOpts = () => ({
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: config.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
  path: '/',
  maxAge: 24 * 60 * 60 * 1000,
})

router.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {}
    const username = typeof body.username === 'string'
      ? body.username.trim().toLowerCase()
      : typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' })
      return
    }

    const user = await getPrisma().user.findUnique({ where: { username } })
    if (!user) {
      await compare('dummy', '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.')
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const valid = await compare(password, user.passwordHash)
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const token = await signToken({ userId: user.id, username: user.username, name: user.name })
    logger.info({ userId: user.id }, 'User logged in')
    res.cookie(COOKIE_NAME, token, cookieOpts())
    res.json({ ok: true, token, username: user.username, name: user.name })
  } catch (err) {
    next(err)
  }
})

router.post('/signup', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {}
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : email

    if (!username || !password) {
      res.status(400).json({ error: 'Email and password are required' })
      return
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' })
      return
    }

    const prisma = getPrisma()
    const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } })
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' })
      return
    }

    const passwordHash = await hash(password, 12)
    const user = await prisma.user.create({ data: { username, passwordHash, name } })
    const token = await signToken({ userId: user.id, username: user.username, name: user.name })
    logger.info({ userId: user.id }, 'User signed up')
    res.cookie(COOKIE_NAME, token, cookieOpts())
    res.json({ ok: true, token, username: user.username, name: user.name })
  } catch (err) {
    next(err)
  }
})

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, { path: '/' })
  res.json({ ok: true })
})

router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    const user = await getPrisma().user.findUnique({
      where: { id: userId },
      select: { username: true, name: true },
    })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json({ username: user.username, name: user.name })
  } catch (err) {
    next(err)
  }
})

export default router
