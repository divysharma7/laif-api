import { Router, type Request, type Response, type NextFunction } from 'express'
import type { Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../lib/prisma.js'
import { FocusPreferencesSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'

const router = Router()

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
