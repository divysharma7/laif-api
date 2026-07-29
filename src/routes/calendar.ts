import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { AgendaQuerySchema, parseBody } from '../lib/validation.js'
import { AppError, NotFoundError } from '../lib/errors.js'
import { isValidIanaTimeZone, localDateKey, utcBoundsForLocalDate } from '../lib/timeZone.js'
import type {
  AgendaAction,
  AgendaItem,
  AgendaResponse,
  AgendaUnscheduledPriority,
} from '../contracts/agenda.js'

const router = Router()

type ApiRecord = Record<string, unknown> & { id: string }

function serializeRecord(value: ApiRecord): Record<string, unknown> {
  const { id, ...rest } = value
  return { ...rest, _id: id }
}

function serializeEmbedded(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('id' in value)) return value
  return serializeRecord(value as ApiRecord)
}

function serializeTask(value: ApiRecord): Record<string, unknown> {
  const serialized = serializeRecord(value)
  if (serialized.status === 'in_progress') serialized.status = 'in-progress'
  if (Array.isArray(serialized.comments)) serialized.comments = serialized.comments.map(serializeEmbedded)
  if (Array.isArray(serialized.activities)) serialized.activities = serialized.activities.map(serializeEmbedded)
  if (Array.isArray(serialized.reminders)) {
    serialized.reminders = serialized.reminders.map((reminder) => {
      const reminderRecord = reminder as ApiRecord
      const item: Record<string, unknown> & { id: string } = {
        ...(serializeEmbedded(reminder) as Record<string, unknown>),
        // Task reminder IDs are application-supplied and part of the public body.
        id: reminderRecord.id,
      }
      if (item.type === 'before_start') item.type = 'before-start'
      if (item.type === 'on_day_at') item.type = 'on-day-at'
      return item
    })
  }
  if (Array.isArray(serialized.completions)) {
    serialized.completions = serialized.completions.map((completion) => {
      const item = serializeEmbedded(completion) as Record<string, unknown>
      if (item.date instanceof Date) item.date = item.date.toISOString().slice(0, 10)
      return item
    })
  }
  return serialized
}

function serializeEvent(value: ApiRecord): Record<string, unknown> {
  const serialized = serializeRecord(value)
  if (Array.isArray(serialized.comments)) serialized.comments = serialized.comments.map(serializeEmbedded)
  return serialized
}

const taskRelations = {
  comments: { orderBy: { createdAt: 'asc' as const } },
  reminders: true,
  completions: { orderBy: { date: 'asc' as const } },
  activities: { orderBy: { timestamp: 'asc' as const } },
}

type ScheduledAgendaTask = {
  id: string
  title: string
  scheduledStart: Date | null
  scheduledEnd: Date | null
  estimatedEffort: number | null
  dueDate: Date | null
  priority: 'low' | 'medium' | 'high' | null
  status: 'backlog' | 'todo' | 'in_progress' | 'done' | 'dropped'
  color: string
  isHabit: boolean
  completions: { status: 'achieved' | 'unachieved' | 'skipped' | 'frozen' }[]
}

type UnscheduledAgendaTask = {
  id: string
  title: string
  estimatedEffort: number | null
  dueDate: Date | null
  priority: 'low' | 'medium' | 'high' | null
  createdAt: Date
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

function estimatedMinutes(hours: number | null): number | undefined {
  if (hours === null || hours <= 0) return undefined
  return Math.max(1, Math.round(hours * 60))
}

function agendaTaskItem(task: ScheduledAgendaTask): AgendaItem | null {
  if (!task.scheduledStart) return null
  const completed = task.status === 'done'
    || (task.isHabit && task.completions.some(completion => completion.status === 'achieved'))
  const actions: AgendaAction[] = completed
    ? ['view']
    : task.isHabit
      ? ['complete', 'focus', 'reschedule']
      : ['complete', 'focus', 'reschedule']
  const duration = estimatedMinutes(task.estimatedEffort) ?? 30
  const end = task.scheduledEnd ?? addMinutes(task.scheduledStart, duration)

  return {
    id: task.id,
    kind: task.isHabit ? 'habit' : 'task',
    title: task.title,
    start: task.scheduledStart.toISOString(),
    end: end.toISOString(),
    allDay: false,
    completed,
    source: { type: 'lifeos' },
    availability: task.isHabit ? 'free' : 'busy',
    color: task.color,
    actions,
  }
}

function compareAgendaItems(left: AgendaItem, right: AgendaItem): number {
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1
  const leftStart = left.start ?? ''
  const rightStart = right.start ?? ''
  if (leftStart !== rightStart) return leftStart.localeCompare(rightStart)
  const leftEnd = left.end ?? ''
  const rightEnd = right.end ?? ''
  if (leftEnd !== rightEnd) return leftEnd.localeCompare(rightEnd)
  if (left.kind !== right.kind) return left.kind.localeCompare(right.kind)
  return left.id.localeCompare(right.id)
}

function unscheduledPriority(
  task: UnscheduledAgendaTask,
  timeZone: string,
): AgendaUnscheduledPriority {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority ?? 'medium',
    ...(estimatedMinutes(task.estimatedEffort) !== undefined
      ? { estimatedMinutes: estimatedMinutes(task.estimatedEffort) }
      : {}),
    ...(task.dueDate ? { dueDate: localDateKey(task.dueDate, timeZone) } : {}),
  }
}

function compareUnscheduled(
  left: UnscheduledAgendaTask,
  right: UnscheduledAgendaTask,
): number {
  const priorityRank = { high: 0, medium: 1, low: 2 }
  const priorityDifference =
    priorityRank[left.priority ?? 'medium'] - priorityRank[right.priority ?? 'medium']
  if (priorityDifference !== 0) return priorityDifference
  if (left.dueDate && right.dueDate) {
    const dueDifference = left.dueDate.getTime() - right.dueDate.getTime()
    if (dueDifference !== 0) return dueDifference
  } else if (left.dueDate || right.dueDate) {
    return left.dueDate ? -1 : 1
  }
  const createdDifference = left.createdAt.getTime() - right.createdAt.getTime()
  if (createdDifference !== 0) return createdDifference
  return left.id.localeCompare(right.id)
}

router.get('/agenda', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(AgendaQuerySchema, req.query)
    if (!parsed.success) {
      throw new AppError(parsed.error, 'VALIDATION_ERROR', 400)
    }

    const prisma = getPrisma()
    const userId = req.userId!
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        timezone: true,
      },
    })
    if (!user) throw new NotFoundError('User', userId)

    const requestedTimeZone = parsed.data.timeZone
      ?? (isValidIanaTimeZone(user.timezone) ? user.timezone : 'UTC')
    const bounds = utcBoundsForLocalDate(parsed.data.date, requestedTimeZone)
    const completionDate = new Date(`${parsed.data.date}T00:00:00.000Z`)

    const [
      scheduledTasks,
      externalEvents,
      focusSessions,
      unscheduledTasks,
      calendarAccount,
    ] = await Promise.all([
      prisma.task.findMany({
        where: {
          userId,
          status: { not: 'dropped' },
          scheduledStart: { not: null, lt: bounds.end },
          OR: [
            { scheduledEnd: { gt: bounds.start } },
            {
              scheduledEnd: null,
              scheduledStart: { gte: bounds.start },
            },
          ],
        },
        select: {
          id: true,
          title: true,
          scheduledStart: true,
          scheduledEnd: true,
          estimatedEffort: true,
          dueDate: true,
          priority: true,
          status: true,
          color: true,
          isHabit: true,
          completions: {
            where: { date: completionDate },
            select: { status: true },
            take: 1,
          },
        },
      }),
      prisma.externalCalendarEvent.findMany({
        where: {
          userId,
          calendar: {
            isActiveInAgenda: true,
            hidden: false,
            account: { disconnectedAt: null },
          },
          start: { lt: bounds.end },
          end: { gt: bounds.start },
        },
        include: {
          calendar: {
            select: {
              name: true,
              providerColor: true,
              colorOverride: true,
              affectsAvailability: true,
            },
          },
        },
        orderBy: [
          { start: 'asc' },
          { end: 'asc' },
          { id: 'asc' },
        ],
      }),
      prisma.focusSession.findMany({
        where: {
          userId,
          status: 'completed',
          startedAt: { lt: bounds.end },
          OR: [
            { endedAt: { gt: bounds.start } },
            {
              endedAt: null,
              startedAt: { gte: bounds.start },
            },
          ],
        },
        orderBy: [
          { startedAt: 'asc' },
          { id: 'asc' },
        ],
      }),
      prisma.task.findMany({
        where: {
          userId,
          isHabit: false,
          scheduledStart: null,
          status: { notIn: ['done', 'dropped'] },
        },
        select: {
          id: true,
          title: true,
          priority: true,
          estimatedEffort: true,
          dueDate: true,
          createdAt: true,
        },
        take: 50,
      }),
      prisma.calendarAccount.findFirst({
        where: {
          userId,
          provider: 'google',
          disconnectedAt: null,
        },
        orderBy: { lastSuccessfulSyncAt: 'desc' },
        select: {
          status: true,
          reconnectRequired: true,
          lastSuccessfulSyncAt: true,
        },
      }),
    ])

    const taskItems = (scheduledTasks as ScheduledAgendaTask[])
      .map(agendaTaskItem)
      .filter((item): item is AgendaItem => item !== null)
    const externalItems: AgendaItem[] = externalEvents.flatMap(event => {
      if (!event.calendar) return []

      // Handle private events — always show as "Busy"
      const isPrivate = event.visibility === 'private' || event.visibility === 'confidential'
      const title = isPrivate ? 'Busy' : event.title

      // Handle transparency — transparent events are free, not busy
      const isTransparent = event.transparency === 'transparent'
      const availability = isTransparent ? 'free' : (event.calendar.affectsAvailability ? 'busy' : 'free')

      // Handle exclusive all-day end dates — Google uses exclusive end dates
      // For display, we keep the exclusive end as-is (the frontend handles rendering)
      // For bounds checking, the existing query already handles this correctly

      return [{
        id: event.id,
        kind: 'external_event',
        title,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
        allDay: event.allDay,
        completed: false,
        source: {
          type: 'google',
          accountId: event.accountId,
          calendarId: event.calendarId,
          displayName: isPrivate ? undefined : event.calendar.name,
        },
        availability,
        color: event.calendar.colorOverride || event.calendar.providerColor || '#4285f4',
        actions: ['view'],
      }]
    })
    const focusItems: AgendaItem[] = focusSessions.map(session => {
      const fallbackMinutes = Math.max(1, session.actualDurationMin)
      const end = session.endedAt ?? addMinutes(session.startedAt, fallbackMinutes)
      return {
        id: session.id,
        kind: 'focus_session',
        title: session.taskTitleSnapshot || 'Focus session',
        start: session.startedAt.toISOString(),
        end: end.toISOString(),
        allDay: false,
        completed: true,
        source: { type: 'lifeos' },
        availability: 'busy',
        color: '#10b981',
        actions: ['view'],
      }
    })

    const syncState = !calendarAccount || calendarAccount.status === 'disconnected'
      ? 'not_connected'
      : calendarAccount.reconnectRequired || calendarAccount.status === 'needs_attention'
        ? 'needs_attention'
        : calendarAccount.status === 'healthy'
          ? 'healthy'
          : 'delayed'
    const response: AgendaResponse = {
      date: parsed.data.date,
      timeZone: requestedTimeZone,
      generatedAt: new Date().toISOString(),
      sync: {
        state: syncState,
        lastSuccessfulAt: calendarAccount?.lastSuccessfulSyncAt?.toISOString() ?? null,
      },
      items: [...taskItems, ...externalItems, ...focusItems].sort(compareAgendaItems),
      unscheduledPriorities: (unscheduledTasks as UnscheduledAgendaTask[])
        .sort(compareUnscheduled)
        .map(task => unscheduledPriority(task, requestedTimeZone)),
    }

    res.json(response)
  } catch (err) {
    next(err)
  }
})

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    const userId = req.userId!
    const [events, tasks, reminders] = await Promise.all([
      prisma.event.findMany({
        where: { userId },
        include: { comments: { orderBy: { createdAt: 'asc' } } },
      }),
      prisma.task.findMany({
        where: { userId, dueDate: { not: null } },
        include: taskRelations,
      }),
      prisma.reminder.findMany({
        where: { userId },
        include: { comments: { orderBy: { createdAt: 'asc' } } },
      }),
    ])
    const items = [
      ...events.map(event => ({ ...serializeEvent(event), itemType: 'event' })),
      ...tasks.map(task => ({ ...serializeTask(task), itemType: 'task' })),
      ...reminders.map(reminder => ({ ...serializeEvent(reminder), itemType: 'reminder' })),
    ]
    res.json(items)
  } catch (err) { next(err) }
})

router.get('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    const userId = req.userId!
    const { from, to, include } = req.query as Record<string, string>
    const includeSet = new Set((include || 'tasks,habits,google,focus').split(','))
    const results: Record<string, unknown>[] = []

    if (includeSet.has('tasks')) {
      const scheduledStart: { not: null; gte?: Date; lte?: Date } = { not: null }
      if (from) scheduledStart.gte = new Date(from)
      if (to) scheduledStart.lte = new Date(to)
      const tasks = await prisma.task.findMany({
        where: { userId, scheduledStart },
        include: taskRelations,
      })
      results.push(...tasks.map(task => ({
        ...serializeTask(task),
        calendarType: task.isHabit ? 'habit' : 'task',
      })))
    }
    if (includeSet.has('google')) {
      const start: { gte?: Date; lte?: Date } = {}
      if (from) start.gte = new Date(from)
      if (to) start.lte = new Date(to)
      const externalEvents = await prisma.externalCalendarEvent.findMany({
        where: {
          userId,
          ...((from || to) ? { start } : {}),
        },
      })
      results.push(...externalEvents.map(event => ({
        ...serializeRecord(event),
        calendarType: 'google',
      })))
    }
    if (includeSet.has('focus')) {
      const startedAt: { gte?: Date; lte?: Date } = {}
      if (from) startedAt.gte = new Date(from)
      if (to) startedAt.lte = new Date(to)
      const sessions = await prisma.focusSession.findMany({
        where: {
          userId,
          status: 'completed',
          ...((from || to) ? { startedAt } : {}),
        },
      })
      results.push(...sessions.map(session => ({
        ...serializeRecord(session),
        calendarType: 'focus',
      })))
    }
    res.json(results)
  } catch (err) { next(err) }
})

router.get('/unscheduled', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await getPrisma().task.findMany({
      where: {
        userId: req.userId!,
        scheduledStart: null,
        status: { notIn: ['done', 'dropped'] },
      },
      orderBy: { createdAt: 'desc' },
      include: taskRelations,
    })
    res.json(tasks.map(serializeTask))
  } catch (err) { next(err) }
})

router.get('/overdue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await getPrisma().task.findMany({
      where: {
        userId: req.userId!,
        scheduledStart: { lt: new Date() },
        status: { notIn: ['done', 'dropped'] },
      },
      orderBy: { scheduledStart: 'asc' },
      include: taskRelations,
    })
    res.json(tasks.map(serializeTask))
  } catch (err) { next(err) }
})

router.get('/capacity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = req.query as Record<string, string>
    const scheduledStart: { not: null; gte?: Date; lte?: Date } = { not: null }
    if (from) scheduledStart.gte = new Date(from)
    if (to) scheduledStart.lte = new Date(to)
    const tasks = await getPrisma().task.findMany({
      where: { userId: req.userId!, scheduledStart },
      select: { scheduledStart: true, estimatedEffort: true },
    })
    const byDay: Record<string, number> = {}
    for (const task of tasks) {
      if (!task.scheduledStart) continue
      const day = task.scheduledStart.toISOString().split('T')[0]
      byDay[day] = (byDay[day] || 0) + (task.estimatedEffort || 0.5)
    }
    res.json(Object.entries(byDay).map(([date, hours]) => ({ date, scheduledHours: hours })))
  } catch (err) { next(err) }
})

router.get('/heatmap', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await getPrisma().task.findMany({
      where: { userId: req.userId!, status: 'done', completedAt: { not: null } },
      select: { completedAt: true },
    })
    const byDay: Record<string, number> = {}
    for (const task of tasks) {
      if (!task.completedAt) continue
      const day = task.completedAt.toISOString().split('T')[0]
      byDay[day] = (byDay[day] || 0) + 1
    }
    res.json(Object.entries(byDay).map(([date, count]) => ({ date, count })))
  } catch (err) { next(err) }
})

export default router
