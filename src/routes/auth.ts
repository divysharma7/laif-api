import { Router, type Request, type Response, type NextFunction } from 'express'
import bcryptjs from 'bcryptjs'
const { compare, hash } = bcryptjs
import { signToken, COOKIE_NAME } from '../lib/auth.js'
import { config } from '../config.js'
import UserModel from '../models/User.js'
import { authLimiter } from '../middleware/rateLimiter.js'
import { logger } from '../lib/logger.js'

const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

const cookieOpts = () => ({
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 24 * 60 * 60 * 1000,
})

// POST /auth/login
router.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {}
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase()
                   : typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' }); return
    }

    const user = await UserModel.findOne({ username }).lean() as LeanDoc | null

    if (!user) {
      await compare('dummy', '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.')
      res.status(401).json({ error: 'Invalid credentials' }); return
    }

    const valid = await compare(password, user.passwordHash as string)
    if (!valid) { res.status(401).json({ error: 'Invalid credentials' }); return }

    const token = await signToken({ userId: String(user._id), username: user.username as string, name: (user.name as string) || '' })
    logger.info({ userId: String(user._id) }, 'User logged in')

    res.cookie(COOKIE_NAME, token, cookieOpts())
    res.json({ ok: true, token, username: user.username, name: user.name || '' })
  } catch (err) { next(err) }
})

// POST /auth/signup
router.post('/signup', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {}
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : email

    if (!username || !password) { res.status(400).json({ error: 'Email and password are required' }); return }
    if (password.length < 6) { res.status(400).json({ error: 'Password must be at least 6 characters' }); return }

    const existing = await UserModel.findOne({ username }).lean()
    if (existing) { res.status(409).json({ error: 'An account with this email already exists' }); return }

    const passwordHash = await hash(password, 12)
    const user = await UserModel.create({ username, passwordHash, name: name || undefined })
    const token = await signToken({ userId: String(user._id), username: user.username, name: user.name || '' })
    logger.info({ userId: String(user._id) }, 'User signed up')

    res.cookie(COOKIE_NAME, token, cookieOpts())
    res.json({ ok: true, token, username: user.username, name: user.name || '' })
  } catch (err) { next(err) }
})

// POST /auth/logout
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, { path: '/' })
  res.json({ ok: true })
})

// GET /auth/me
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return }
    const user = await UserModel.findById(userId).select('username name').lean() as LeanDoc | null
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    res.json({ username: user.username, name: user.name || '' })
  } catch (err) { next(err) }
})

export default router
