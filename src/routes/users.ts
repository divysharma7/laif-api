import { Router, type Request, type Response, type NextFunction } from 'express'
import type { Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../lib/prisma.js'
import { FocusPreferencesSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import bcryptjs from 'bcryptjs'
import { COOKIE_NAME } from '../lib/auth.js'
import { config } from '../config.js'

const router = Router()
const { compare } = bcryptjs

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

router.get('/me/focus-preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getPrisma().user.findUnique({
      where: { id: req.userId! },
      select: { focusPreferences: true },
    })
    if (!user) throw new NotFoundError('User', req.userId!)
    res.json(user.focusPreferences ?? {})
  } catch (err) {
    next(err)
  }
})

router.patch('/me/focus-preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(FocusPreferencesSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const prisma = getPrisma()
    const current = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { focusPreferences: true },
    })
    if (!current) throw new NotFoundError('User', req.userId!)
    const focusPreferences = {
      ...jsonObject(current.focusPreferences),
      ...Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)),
    }
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { focusPreferences: focusPreferences as Prisma.InputJsonValue },
      select: { focusPreferences: true },
    })
    res.json(user.focusPreferences)
  } catch (err) {
    next(err)
  }
})

router.get('/me/calendar-preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getPrisma().user.findUnique({
      where: { id: req.userId! },
      select: { calendarPreferences: true },
    })
    if (!user) throw new NotFoundError('User', req.userId!)
    res.json(user.calendarPreferences ?? {})
  } catch (err) {
    next(err)
  }
})

router.patch('/me/calendar-preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    const current = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { calendarPreferences: true },
    })
    if (!current) throw new NotFoundError('User', req.userId!)
    const calendarPreferences = {
      ...jsonObject(current.calendarPreferences),
      ...Object.fromEntries(Object.entries(req.body ?? {}).filter(([, value]) => value !== undefined)),
    }
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { calendarPreferences: calendarPreferences as Prisma.InputJsonValue },
      select: { calendarPreferences: true },
    })
    res.json(user.calendarPreferences)
  } catch (err) {
    next(err)
  }
})

router.patch('/me/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!name || name.length > 200) {
      throw new ValidationError('Name must be between 1 and 200 characters')
    }
    const user = await getPrisma().user.update({
      where: { id: req.userId! },
      data: { name },
      select: { username: true, name: true },
    })
    res.json(user)
  } catch (err) {
    next(err)
  }
})

router.get('/me/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getPrisma().user.findUnique({
      where: { id: req.userId! },
      select: {
        username: true,
        name: true,
        timezone: true,
        habitSettings: true,
        focusPreferences: true,
        calendarPreferences: true,
        createdAt: true,
        updatedAt: true,
        tasks: true,
        lists: true,
        listGroups: true,
        workflows: true,
        events: true,
        reminders: true,
        focusSessions: true,
        focusRecords: true,
        focusSettings: true,
        chatSessions: { include: { messages: true } },
        memories: true,
        calendarAccounts: {
          select: {
            id: true,
            provider: true,
            email: true,
            status: true,
            lastSuccessfulSyncAt: true,
            lastErrorCode: true,
            reconnectRequired: true,
            disconnectedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        calendars: true,
      },
    })
    if (!user) throw new NotFoundError('User', req.userId!)
    res.json({
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      account: user,
    })
  } catch (err) {
    next(err)
  }
})

router.post('/me/delete-account', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (!password) {
      res.status(400).json({ error: 'Password is required' })
      return
    }
    const prisma = getPrisma()
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { id: true, passwordHash: true },
    })
    if (!user) throw new NotFoundError('User', req.userId!)
    if (!(await compare(password, user.passwordHash))) {
      res.status(401).json({ error: 'Password is incorrect' })
      return
    }
    await prisma.user.delete({ where: { id: user.id } })
    res.clearCookie(COOKIE_NAME, {
      path: '/',
      secure: config.NODE_ENV === 'production',
      sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax',
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

router.get('/me/mcp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getPrisma().user.findUnique({
      where: { id: req.userId! },
      select: { mcpEnabled: true, mcpApiKey: true },
    })
    if (!user) throw new NotFoundError('User', req.userId!)
    res.json(user)
  } catch (err) {
    next(err)
  }
})

router.patch('/me/mcp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data: { mcpEnabled?: boolean; mcpApiKey?: string } = {}
    if (typeof req.body?.mcpEnabled === 'boolean') {
      data.mcpEnabled = req.body.mcpEnabled
      if (req.body.mcpEnabled && !req.body.mcpApiKey) {
        const { v4 } = await import('uuid')
        data.mcpApiKey = v4()
      }
    }
    if (typeof req.body?.mcpApiKey === 'string' && req.body.mcpApiKey) {
      data.mcpApiKey = req.body.mcpApiKey
    }
    const user = await getPrisma().user.update({
      where: { id: req.userId! },
      data,
      select: { mcpEnabled: true, mcpApiKey: true },
    })
    res.json(user)
  } catch (err) {
    next(err)
  }
})

export default router
