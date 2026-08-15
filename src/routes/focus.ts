import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'
import {
  CreateFocusSessionSchema,
  FocusSessionActionSchema,
  CompleteActiveFocusSessionSchema,
  CreateFocusRecordSchema,
  UpdateFocusSettingsSchema,
  FocusDashboardQuerySchema,
  FocusRecordsQuerySchema,
  FocusTargetSearchSchema,
  parseBody,
} from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { isValidIanaTimeZone } from '../lib/timeZone.js'
import * as focusRecordService from '../services/focusRecordService.js'
import * as focusSettingsService from '../services/focusSettingsService.js'

const router = Router()

type ApiRecord = Record<string, unknown> & { id: string }

function serializeSession(value: ApiRecord): Record<string, unknown> {
  const { id, ...rest } = value
  return { ...rest, _id: id }
}

function serializeRecord(value: ApiRecord): Record<string, unknown> {
  const { id, deletedAt, ...rest } = value
  return { ...rest, _id: id }
}

function requestTimezone(req: Request, queryTimezone?: string): string {
  const headerTimezone = typeof req.headers['x-timezone'] === 'string'
    ? req.headers['x-timezone']
    : undefined
  if (queryTimezone) return queryTimezone
  return headerTimezone && isValidIanaTimeZone(headerTimezone) ? headerTimezone : 'UTC'
}

async function completeFocusSession(
  sessionId: string,
  userId: string,
  postSessionNote?: string,
  timezone: string = 'UTC',
) {
  const prisma = getPrisma()

  return prisma.$transaction(async (transaction) => {
    const session = await transaction.focusSession.findFirst({
      where: { id: sessionId, userId },
    })
    if (!session) throw new NotFoundError('FocusSession', sessionId)

    // A repeated completion is a successful no-op.
    if (session.status === 'completed') return session
    if (session.status !== 'active') {
      throw new ValidationError('Only an active focus session can be completed')
    }

    const endedAt = new Date()
    const currentPauseMs = session.pausedAt
      ? Math.max(0, endedAt.getTime() - session.pausedAt.getTime())
      : 0
    const totalPausedMs = session.totalPausedMs + currentPauseMs
    const actualDurationSeconds = Math.max(
      0,
      Math.round((endedAt.getTime() - session.startedAt.getTime() - totalPausedMs) / 1000),
    )
    const plannedDurationSeconds = (session.plannedDurationMin + session.extendedByMin) * 60
    const durationSeconds = session.mode === 'POMO'
      ? Math.min(actualDurationSeconds, plannedDurationSeconds)
      : actualDurationSeconds

    // Claim completion atomically so concurrent/retried requests create one record.
    const claimed = await transaction.focusSession.updateMany({
      where: { id: sessionId, userId, status: 'active' },
      data: {
        status: 'completed',
        endedAt,
        endedReason: 'user_completed',
        pausedAt: null,
        totalPausedMs,
        actualDurationMin: Math.round(durationSeconds / 60),
        ...(postSessionNote ? { postSessionNote } : {}),
      },
    })

    if (claimed.count === 0) {
      const current = await transaction.focusSession.findFirst({
        where: { id: sessionId, userId },
      })
      if (current) return current
      throw new NotFoundError('FocusSession', sessionId)
    }

    const originalTargetId = session.taskId || session.habitId
    const ownedTarget = originalTargetId
      ? await transaction.task.findFirst({
          where: { id: originalTargetId, userId },
          select: { id: true },
        })
      : null

    await transaction.focusRecord.create({
      data: {
        userId,
        targetType: session.targetType,
        targetId: ownedTarget?.id ?? null,
        targetTitleSnapshot: session.taskTitleSnapshot,
        startTime: session.startedAt,
        endTime: endedAt,
        durationSeconds,
        mode: session.mode,
        pomoCount: session.mode === 'POMO' ? 1 : 0,
        note: postSessionNote ?? null,
        source: 'TIMER',
        timezone,
      },
    })

    return {
      ...session,
      status: 'completed' as const,
      endedAt,
      endedReason: 'user_completed' as const,
      pausedAt: null,
      totalPausedMs,
      actualDurationMin: Math.round(durationSeconds / 60),
      ...(postSessionNote ? { postSessionNote } : {}),
    }
  })
}

// ── Existing Session Endpoints (Enhanced) ─────────────────────────────────

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
      // Cancel any existing active session
      await transaction.focusSession.updateMany({
        where: { userId, status: 'active' },
        data: {
          status: 'cancelled',
          endedAt: new Date(),
          endedReason: 'user_cancelled',
        },
      })

      // Resolve target info
      let taskTitleSnapshot: string | null = null
      const targetType = parsed.data.targetType ?? (parsed.data.taskId ? 'TASK' : 'NONE')
      const targetId = parsed.data.targetId || parsed.data.taskId

      if (targetType === 'TASK' && targetId) {
        const task = await transaction.task.findFirst({
          where: { id: targetId, userId, isHabit: false },
          select: { title: true },
        })
        if (!task) throw new NotFoundError('Task', targetId)
        taskTitleSnapshot = task.title
      } else if (targetType === 'HABIT' && targetId) {
        const habit = await transaction.task.findFirst({
          where: { id: targetId, userId, isHabit: true },
          select: { title: true },
        })
        if (!habit) throw new NotFoundError('Habit', targetId)
        taskTitleSnapshot = habit.title
      } else if (parsed.data.taskTitle) {
        taskTitleSnapshot = parsed.data.taskTitle
      }

      return transaction.focusSession.create({
        data: {
          userId,
          taskId: targetType === 'TASK' ? targetId : null,
          habitId: targetType === 'HABIT' ? targetId : null,
          targetType,
          mode: parsed.data.mode || 'POMO',
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

router.post('/sessions/active/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CompleteActiveFocusSessionSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const userId = req.userId!
    const activeSession = await getPrisma().focusSession.findFirst({
      where: { userId, status: 'active' },
      select: { id: true },
    })

    // Retried completion after the first request is an idempotent no-op.
    if (!activeSession) {
      res.status(204).send()
      return
    }

    const completed = await completeFocusSession(
      activeSession.id,
      userId,
      parsed.data.postSessionNote,
      requestTimezone(req),
    )
    res.json(serializeSession(completed as unknown as ApiRecord))
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

    if (action === 'complete') {
      const completed = await completeFocusSession(
        session.id,
        userId,
        postSessionNote,
        requestTimezone(req),
      )
      res.json(serializeSession(completed as unknown as ApiRecord))
      return
    }

    if (session.status !== 'active') {
      throw new ValidationError('Only an active focus session can be changed')
    }
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
      case 'cancel':
        data.status = 'cancelled'
        data.endedAt = new Date()
        data.endedReason = endedReason || 'user_cancelled'
        if (postSessionNote) data.postSessionNote = postSessionNote
        data.actualDurationMin = Math.round(
          (Date.now() - session.startedAt.getTime() - session.totalPausedMs) / 60000,
        )

        break
    }

    const updated = await prisma.focusSession.update({
      where: { id: session.id },
      data,
    })
    res.json(serializeSession(updated))
  } catch (err) { next(err) }
})

// ── Dashboard Endpoint ────────────────────────────────────────────────────

router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(FocusDashboardQuerySchema, req.query)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const userId = req.userId!
    const timezone = requestTimezone(req, parsed.data.timezone)

    // Keep Prisma adapter work sequential within a request. Concurrent unnamed
    // prepared statements can otherwise collide on the same PG connection.
    const activeSession = await getPrisma().focusSession.findFirst({
      where: { userId, status: 'active' },
    })
    const overview = await focusRecordService.getOverview(userId, timezone)
    const recordsResult = await focusRecordService.getRecords({ userId, limit: 50 })

    res.json({
      activeSession: activeSession ? serializeSession(activeSession as unknown as ApiRecord) : null,
      overview,
      records: recordsResult.items.map(serializeRecord),
      nextCursor: recordsResult.nextCursor,
      hasMore: recordsResult.hasMore,
    })
  } catch (err) { next(err) }
})

// ── Focus Records Endpoints ───────────────────────────────────────────────

router.get('/records', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(FocusRecordsQuerySchema, req.query)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const result = await focusRecordService.getRecords({
      userId: req.userId!,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    })

    res.json({
      items: result.items.map(serializeRecord),
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    })
  } catch (err) { next(err) }
})

router.post('/records', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateFocusRecordSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const startTime = new Date(parsed.data.startTime)
    const endTime = new Date(parsed.data.endTime)
    const durationSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000)

    let targetTitleSnapshot = parsed.data.targetTitleSnapshot
    if (parsed.data.targetType !== 'NONE') {
      const target = await getPrisma().task.findFirst({
        where: {
          id: parsed.data.targetId!,
          userId: req.userId!,
          isHabit: parsed.data.targetType === 'HABIT',
        },
        select: { title: true },
      })
      if (!target) throw new NotFoundError(
        parsed.data.targetType === 'HABIT' ? 'Habit' : 'Task',
        parsed.data.targetId!,
      )
      targetTitleSnapshot = target.title
    }

    const record = await focusRecordService.createRecord({
      userId: req.userId!,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetType === 'NONE' ? null : parsed.data.targetId,
      targetTitleSnapshot,
      startTime,
      endTime,
      durationSeconds,
      mode: parsed.data.mode,
      pomoCount: parsed.data.pomoCount,
      note: parsed.data.note,
      source: 'MANUAL',
      timezone: parsed.data.timezone,
    })

    res.status(201).json(serializeRecord(record as unknown as ApiRecord))
  } catch (err) { next(err) }
})

router.delete('/records/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await focusRecordService.deleteRecord(req.userId!, req.params.id)
    res.status(204).send()
  } catch (err) {
    if (err instanceof Error && err.message === 'Focus record not found') {
      next(new NotFoundError('FocusRecord', req.params.id))
    } else {
      next(err)
    }
  }
})

// ── Focus Settings Endpoints ──────────────────────────────────────────────

router.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await focusSettingsService.getSettings(req.userId!)
    res.json(settings)
  } catch (err) { next(err) }
})

router.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateFocusSettingsSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const settings = await focusSettingsService.updateSettings(req.userId!, parsed.data)
    res.json(settings)
  } catch (err) { next(err) }
})

// ── Target Candidates Endpoint ────────────────────────────────────────────

router.get('/targets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(FocusTargetSearchSchema, req.query)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const { type, q, limit } = parsed.data
    const userId = req.userId!
    const prisma = getPrisma()

    const searchFilter = q
      ? { title: { contains: q, mode: 'insensitive' as const } }
      : {}

    if (type === 'TASK') {
      const tasks = await prisma.task.findMany({
        where: {
          userId,
          isHabit: false,
          status: { notIn: ['done', 'dropped'] },
          ...searchFilter,
        },
        select: { id: true, title: true },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      })
      res.json(tasks.map((t) => ({ id: t.id, title: t.title })))
    } else {
      const habits = await prisma.task.findMany({
        where: {
          userId,
          isHabit: true,
          status: { not: 'dropped' },
          ...searchFilter,
        },
        select: { id: true, title: true },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      })
      res.json(habits.map((h) => ({ id: h.id, title: h.title })))
    }
  } catch (err) { next(err) }
})

// ── Enhanced Stats Endpoint ───────────────────────────────────────────────

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(FocusDashboardQuerySchema, req.query)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const userId = req.userId!
    const timezone = requestTimezone(req, parsed.data.timezone)

    const overview = await focusRecordService.getOverview(userId, timezone)

    // Get weekly stats
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    weekStart.setHours(0, 0, 0, 0)

    const weekRecords = await getPrisma().focusRecord.findMany({
      where: {
        userId,
        deletedAt: null,
        startTime: { gte: weekStart },
      },
      select: { durationSeconds: true, pomoCount: true },
    })

    const weekTotalMin = Math.round(
      weekRecords.reduce((sum, r) => sum + r.durationSeconds, 0) / 60,
    )
    const weekSessions = weekRecords.length

    // Get average session duration
    const allRecords = await getPrisma().focusRecord.findMany({
      where: { userId, deletedAt: null },
      select: { durationSeconds: true },
    })
    const avgSessionMin = allRecords.length
      ? Math.round(allRecords.reduce((sum, r) => sum + r.durationSeconds, 0) / allRecords.length / 60)
      : 0

    res.json({
      today: {
        sessions: overview.todayFocusSeconds > 0 ? Math.ceil(overview.todayPomo) : 0,
        totalMin: Math.round(overview.todayFocusSeconds / 60),
      },
      week: {
        sessions: weekSessions,
        totalMin: weekTotalMin,
      },
      total: {
        sessions: allRecords.length,
        totalMin: Math.round(overview.totalFocusSeconds / 60),
      },
      avgSessionMin,
      // New fields from overview
      todayPomo: overview.todayPomo,
      todayFocusSeconds: overview.todayFocusSeconds,
      totalPomo: overview.totalPomo,
      totalFocusSeconds: overview.totalFocusSeconds,
    })
  } catch (err) { next(err) }
})

// ── Statistics Aggregation Endpoints ──────────────────────────────────────

router.get('/statistics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(FocusDashboardQuerySchema, req.query)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const userId = req.userId!
    const groupBy = (req.query.groupBy as string) || 'day'
    const limit = parseInt(req.query.limit as string) || 30
    const timezone = requestTimezone(req, parsed.data.timezone)

    const validGroupBy = ['day', 'week', 'month'].includes(groupBy) ? groupBy as 'day' | 'week' | 'month' : 'day'

    const dailyStats = await focusRecordService.getAggregatedStats(userId, validGroupBy, limit, timezone)
    const topTasks = await focusRecordService.getTopTargets(userId, 'TASK', 10)
    const topHabits = await focusRecordService.getTopTargets(userId, 'HABIT', 10)
    const hourDistribution = await focusRecordService.getFocusByHourOfDay(userId, timezone)

    res.json({
      dailyStats,
      topTasks,
      topHabits,
      hourDistribution,
    })
  } catch (err) { next(err) }
})

export default router
