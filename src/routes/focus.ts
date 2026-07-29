import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { CreateFocusSessionSchema, FocusSessionActionSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'

const router = Router()

type ApiRecord = Record<string, unknown> & { id: string }

function serializeSession(value: ApiRecord): Record<string, unknown> {
  const { id, ...rest } = value
  return { ...rest, _id: id }
}

router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { taskId, from, to } = req.query as Record<string, string>
    const startedAt: { gte?: Date; lte?: Date } = {}
    if (from) startedAt.gte = new Date(from)
    if (to) startedAt.lte = new Date(to)
    const sessions = await getPrisma().focusSession.findMany({
      where: {
        userId: req.userId!,
        ...(taskId ? { taskId } : {}),
        ...((from || to) ? { startedAt } : {}),
      },
      orderBy: { startedAt: 'desc' },
    })
    res.json(sessions.map(serializeSession))
  } catch (err) { next(err) }
})

router.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateFocusSessionSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const prisma = getPrisma()
    const userId = req.userId!
    const session = await prisma.$transaction(async (transaction) => {
      await transaction.focusSession.updateMany({
        where: { userId, status: 'active' },
        data: {
          status: 'cancelled',
          endedAt: new Date(),
          endedReason: 'user_cancelled',
        },
      })

      let taskTitleSnapshot: string | null = null
      if (parsed.data.taskId) {
        const task = await transaction.task.findFirst({
          where: { id: parsed.data.taskId, userId },
          select: { title: true },
        })
        if (!task) throw new NotFoundError('Task', parsed.data.taskId)
        taskTitleSnapshot = task.title
      }

      return transaction.focusSession.create({
        data: {
          userId,
          taskId: parsed.data.taskId,
          plannedDurationMin: parsed.data.plannedDurationMin,
          plannedBreakMin: parsed.data.plannedBreakMin,
          startedAt: new Date(),
          status: 'active',
          taskTitleSnapshot,
        },
      })
    })
    res.status(201).json(serializeSession(session))
  } catch (err) { next(err) }
})

router.get('/sessions/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await getPrisma().focusSession.findFirst({
      where: { userId: req.userId!, status: 'active' },
    })
    res.json(session ? serializeSession(session) : null)
  } catch (err) { next(err) }
})

router.patch('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(FocusSessionActionSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const prisma = getPrisma()
    const userId = req.userId!
    const session = await prisma.focusSession.findFirst({
      where: { id: req.params.id, userId },
    })
    if (!session) throw new NotFoundError('FocusSession', req.params.id)

    const { action, additionalMin, endedReason, postSessionNote } = parsed.data
    const data: {
      pausedAt?: Date | null
      status?: 'active' | 'completed' | 'cancelled'
      totalPausedMs?: number
      extendedByMin?: number
      endedAt?: Date
      endedReason?: 'timer_ended' | 'user_completed' | 'user_cancelled'
      postSessionNote?: string
      actualDurationMin?: number
    } = {}

    switch (action) {
      case 'pause':
        data.pausedAt = new Date()
        data.status = 'active'
        break
      case 'resume':
        if (session.pausedAt) {
          data.totalPausedMs = session.totalPausedMs + (Date.now() - session.pausedAt.getTime())
        }
        data.pausedAt = null
        break
      case 'extend':
        data.extendedByMin = session.extendedByMin + (additionalMin || 0)
        break
      case 'complete':
      case 'cancel':
        data.status = action === 'complete' ? 'completed' : 'cancelled'
        data.endedAt = new Date()
        data.endedReason = endedReason || (action === 'complete' ? 'user_completed' : 'user_cancelled')
        if (postSessionNote) data.postSessionNote = postSessionNote
        data.actualDurationMin = Math.round(
          (Date.now() - session.startedAt.getTime() - session.totalPausedMs) / 60000,
        )
        break
    }

    // The unique update is safe after the owned lookup because userId is immutable.
    const updated = await prisma.focusSession.update({
      where: { id: session.id },
      data,
    })
    res.json(serializeSession(updated))
  } catch (err) { next(err) }
})

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    const userId = req.userId!
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(todayStart)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())

    const [todaySessions, weekSessions, allSessions] = await Promise.all([
      prisma.focusSession.findMany({
        where: { userId, status: 'completed', startedAt: { gte: todayStart } },
        select: { actualDurationMin: true },
      }),
      prisma.focusSession.findMany({
        where: { userId, status: 'completed', startedAt: { gte: weekStart } },
        select: { actualDurationMin: true },
      }),
      prisma.focusSession.findMany({
        where: { userId, status: 'completed' },
        orderBy: { startedAt: 'desc' },
        take: 100,
        select: { actualDurationMin: true },
      }),
    ])

    const sumMin = (sessions: { actualDurationMin: number }[]) =>
      sessions.reduce((sum, session) => sum + session.actualDurationMin, 0)
    res.json({
      today: { sessions: todaySessions.length, totalMin: sumMin(todaySessions) },
      week: { sessions: weekSessions.length, totalMin: sumMin(weekSessions) },
      total: { sessions: allSessions.length, totalMin: sumMin(allSessions) },
      avgSessionMin: allSessions.length ? Math.round(sumMin(allSessions) / allSessions.length) : 0,
    })
  } catch (err) { next(err) }
})

export default router
