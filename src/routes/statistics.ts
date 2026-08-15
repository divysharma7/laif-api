import { Router, type NextFunction, type Request, type Response } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { ValidationError } from '../lib/errors.js'
import { localDateKey, utcBoundsForLocalDate, isValidIanaTimeZone } from '../lib/timeZone.js'
import { StatisticsTaskQuerySchema, parseBody } from '../lib/validation.js'

const router = Router()

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

function requestTimezone(req: Request, queryTimezone?: string): string {
  const headerTimezone = typeof req.headers['x-timezone'] === 'string'
    ? req.headers['x-timezone']
    : undefined
  if (queryTimezone) return queryTimezone
  return headerTimezone && isValidIanaTimeZone(headerTimezone) ? headerTimezone : 'UTC'
}

function resolveTimezone(req: Request): string {
  const query = typeof req.query.timezone === 'string' ? req.query.timezone : undefined
  return requestTimezone(req, query)
}

// ── GET /overview ────────────────────────────────────────────────────────────

router.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 7))
    const timezone = resolveTimezone(req)

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    } catch {
      throw new ValidationError('timezone must be a valid IANA time zone')
    }

    const now = new Date()
    const today = localDateKey(now, timezone)
    const firstDay = addDays(today, -(days - 1))
    const since = utcBoundsForLocalDate(firstDay, timezone).start
    const prisma = getPrisma()

    // Sequential queries — concurrent calls produce PG protocol errors with the driver adapter.
    const tasksCompleted = await prisma.task.count({
      where: { userId: req.userId!, isHabit: false, status: 'done' },
    })
    const tasksCompletedInRange = await prisma.task.count({
      where: { userId: req.userId!, isHabit: false, status: 'done', completedAt: { gte: since } },
    })
    const tasksOpen = await prisma.task.count({
      where: { userId: req.userId!, isHabit: false, status: { notIn: ['done', 'dropped'] } },
    })
    const completedTasks = await prisma.task.findMany({
      where: { userId: req.userId!, isHabit: false, status: 'done', completedAt: { gte: since } },
      select: { completedAt: true },
    })
    const focusSummary = await prisma.focusRecord.aggregate({
      where: { userId: req.userId!, deletedAt: null },
      _sum: { durationSeconds: true, pomoCount: true },
      _count: { id: true },
    })
    const focusRecords = await prisma.focusRecord.findMany({
      where: { userId: req.userId!, deletedAt: null, startTime: { gte: since } },
      select: { startTime: true, durationSeconds: true, pomoCount: true },
    })
    const habits = await prisma.task.findMany({
      where: { userId: req.userId!, isHabit: true, status: { not: 'dropped' } },
      select: { id: true, title: true, streakCurrent: true, streakBest: true },
    })
    const habitLogs = await prisma.habitCompletion.findMany({
      where: {
        task: { userId: req.userId!, isHabit: true },
        date: { gte: since },
      },
      select: { date: true, status: true },
    })

    // Today's focus aggregate
    const { start: todayStart, end: tomorrowStart } = utcBoundsForLocalDate(today, timezone)
    const todayFocusAgg = await prisma.focusRecord.aggregate({
      where: { userId: req.userId!, deletedAt: null, startTime: { gte: todayStart, lt: tomorrowStart } },
      _sum: { durationSeconds: true, pomoCount: true },
    })

    // Today's completed tasks
    const todayCompletedCount = await prisma.task.count({
      where: {
        userId: req.userId!, isHabit: false, status: 'done',
        completedAt: { gte: todayStart, lt: tomorrowStart },
      },
    })

    // Total lists
    const totalLists = await prisma.list.count({
      where: { ownerId: req.userId!, deletedAt: null },
    })

    // Active days (distinct days with task completions or focus records)
    const completedDays = await prisma.task.findMany({
      where: { userId: req.userId!, isHabit: false, status: 'done', completedAt: { not: null } },
      select: { completedAt: true },
    })
    const focusDays = await prisma.focusRecord.findMany({
      where: { userId: req.userId!, deletedAt: null },
      select: { startTime: true },
    })
    const activeDaysSet = new Set<string>()
    for (const t of completedDays) {
      if (t.completedAt) activeDaysSet.add(localDateKey(t.completedAt, timezone))
    }
    for (const f of focusDays) {
      activeDaysSet.add(localDateKey(f.startTime, timezone))
    }

    // Build daily bucket
    const daily = new Map<string, { date: string; tasks: number; focusMinutes: number; habits: number; pomoCount: number }>()
    for (let offset = 0; offset < days; offset += 1) {
      const key = addDays(firstDay, offset)
      daily.set(key, { date: key, tasks: 0, focusMinutes: 0, habits: 0, pomoCount: 0 })
    }
    for (const task of completedTasks) {
      if (!task.completedAt) continue
      const entry = daily.get(localDateKey(task.completedAt, timezone))
      if (entry) entry.tasks += 1
    }
    for (const record of focusRecords) {
      const entry = daily.get(localDateKey(record.startTime, timezone))
      if (entry) {
        entry.focusMinutes += Math.round(record.durationSeconds / 60)
        entry.pomoCount += record.pomoCount
      }
    }
    for (const log of habitLogs) {
      if (log.status !== 'achieved') continue
      const entry = daily.get(localDateKey(log.date, timezone))
      if (entry) entry.habits += 1
    }

    const achievedLogs = habitLogs.filter((log) => log.status === 'achieved').length
    res.json({
      range: { days, timezone, from: since.toISOString(), to: now.toISOString() },
      tasks: { completed: tasksCompleted, completedInRange: tasksCompletedInRange, open: tasksOpen },
      focus: {
        sessions: focusSummary._count.id,
        totalMinutes: Math.round((focusSummary._sum.durationSeconds ?? 0) / 60),
        minutesInRange: focusRecords.reduce((sum, record) => sum + Math.round(record.durationSeconds / 60), 0),
      },
      habits: {
        active: habits.length,
        achievedInRange: achievedLogs,
        bestStreak: habits.reduce((best, habit) => Math.max(best, habit.streakBest), 0),
        currentBestStreak: habits.reduce((best, habit) => Math.max(best, habit.streakCurrent), 0),
      },
      today: {
        completed: todayCompletedCount,
        pomo: todayFocusAgg._sum.pomoCount ?? 0,
        focusSeconds: todayFocusAgg._sum.durationSeconds ?? 0,
      },
      total: {
        completed: tasksCompleted,
        pomo: focusSummary._sum.pomoCount ?? 0,
        focusSeconds: focusSummary._sum.durationSeconds ?? 0,
        lists: totalLists,
      },
      statsDays: activeDaysSet.size,
      daily: [...daily.values()],
    })
  } catch (error) {
    next(error)
  }
})

// ── GET /task ────────────────────────────────────────────────────────────────

router.get('/task', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(StatisticsTaskQuerySchema, req.query)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const { range } = parsed.data
    const timezone = requestTimezone(req, parsed.data.timezone)
    const prisma = getPrisma()
    const userId = req.userId!

    // Resolve the target date (default to today in user's timezone)
    const now = new Date()
    const todayKey = localDateKey(now, timezone)
    const targetDate = parsed.data.date || todayKey

    // Compute current and previous period bounds
    let currentStart: string
    let currentEnd: string
    let previousStart: string
    let previousEnd: string

    if (range === 'day') {
      currentStart = targetDate
      currentEnd = targetDate
      previousStart = addDays(targetDate, -1)
      previousEnd = addDays(targetDate, -1)
    } else if (range === 'week') {
      // Week containing targetDate (Mon-Sun)
      const target = new Date(`${targetDate}T00:00:00.000Z`)
      const dow = target.getUTCDay()
      const mondayOffset = dow === 0 ? -6 : 1 - dow
      currentStart = addDays(targetDate, mondayOffset)
      currentEnd = addDays(currentStart, 6)
      previousStart = addDays(currentStart, -7)
      previousEnd = addDays(previousStart, 6)
    } else {
      // Month containing targetDate
      const [y, m] = targetDate.split('-').map(Number)
      currentStart = `${y}-${String(m).padStart(2, '0')}-01`
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
      currentEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      const prevMonth = m === 1 ? 12 : m - 1
      const prevYear = m === 1 ? y - 1 : y
      previousStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`
      const prevLastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate()
      previousEnd = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevLastDay).padStart(2, '0')}`
    }

    const curBounds = {
      start: utcBoundsForLocalDate(currentStart, timezone).start,
      end: utcBoundsForLocalDate(currentEnd, timezone).end,
    }
    const prevBounds = {
      start: utcBoundsForLocalDate(previousStart, timezone).start,
      end: utcBoundsForLocalDate(previousEnd, timezone).end,
    }

    // ── Current period queries ──
    const curCompletedTasks = await prisma.task.findMany({
      where: {
        userId, isHabit: false, status: 'done',
        completedAt: { gte: curBounds.start, lt: curBounds.end },
      },
      select: { id: true, dueDate: true, completedAt: true, listId: true },
    })

    const curDueTasks = await prisma.task.findMany({
      where: {
        userId, isHabit: false,
        dueDate: { gte: curBounds.start, lt: curBounds.end },
      },
      select: { id: true, status: true, dueDate: true, completedAt: true },
    })

    // ── Previous period queries ──
    const prevCompletedTasks = await prisma.task.findMany({
      where: {
        userId, isHabit: false, status: 'done',
        completedAt: { gte: prevBounds.start, lt: prevBounds.end },
      },
      select: { id: true },
    })

    const prevDueTasks = await prisma.task.findMany({
      where: {
        userId, isHabit: false,
        dueDate: { gte: prevBounds.start, lt: prevBounds.end },
      },
      select: { id: true, status: true, dueDate: true, completedAt: true },
    })

    // ── Classify current period ──
    let onTimeCount = 0
    let overdueCompletedCount = 0
    let undatedCount = 0

    for (const task of curCompletedTasks) {
      if (!task.dueDate) {
        undatedCount++
      } else if (
        task.completedAt
        && localDateKey(task.completedAt, timezone) <= localDateKey(task.dueDate, timezone)
      ) {
        onTimeCount++
      } else {
        overdueCompletedCount++
      }
    }

    // Uncompleted: tasks due in range that aren't done/dropped
    const curUncompletedCount = curDueTasks.filter(
      (t) => t.status !== 'done' && t.status !== 'dropped',
    ).length

    const curTotalApplicable = new Set([
      ...curDueTasks.map(task => task.id),
      ...curCompletedTasks.map(task => task.id),
    ]).size
    const completionRate = curTotalApplicable > 0
      ? Math.round((curCompletedTasks.length / curTotalApplicable) * 100)
      : 0

    // Previous period completion rate
    const prevTotalApplicable = new Set([
      ...prevDueTasks.map(task => task.id),
      ...prevCompletedTasks.map(task => task.id),
    ]).size
    const prevCompletionRate = prevTotalApplicable > 0
      ? Math.round((prevCompletedTasks.length / prevTotalApplicable) * 100)
      : 0

    // ── Daily completions within current period ──
    const dailyMap = new Map<string, number>()
    // Initialize all days in range
    let cursor = currentStart
    while (cursor <= currentEnd) {
      dailyMap.set(cursor, 0)
      cursor = addDays(cursor, 1)
    }
    for (const task of curCompletedTasks) {
      if (!task.completedAt) continue
      const key = localDateKey(task.completedAt, timezone)
      if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1)
    }

    // ── Classified by list ──
    const listIds = new Set(curCompletedTasks.map((t) => t.listId).filter(Boolean) as string[])
    let listNames: Map<string, string> = new Map()
    if (listIds.size > 0) {
      const lists = await prisma.list.findMany({
        where: { id: { in: [...listIds] }, ownerId: userId },
        select: { id: true, title: true },
      })
      listNames = new Map(lists.map((l) => [l.id, l.title]))
    }

    const byListMap = new Map<string | null, number>()
    for (const task of curCompletedTasks) {
      const key = task.listId ?? null
      byListMap.set(key, (byListMap.get(key) ?? 0) + 1)
    }
    const byList = [...byListMap.entries()].map(([listId, count]) => ({
      listId,
      listName: listId ? (listNames.get(listId) ?? 'Untitled List') : 'No List',
      count,
    })).sort((a, b) => b.count - a.count)

    res.json({
      current: {
        completedTasks: curCompletedTasks.length,
        completionRate,
        overdueTasks: overdueCompletedCount,
        onTimeTasks: onTimeCount,
        undatedTasks: undatedCount,
        uncompletedTasks: curUncompletedCount,
        totalApplicable: curTotalApplicable,
        dailyCompletions: [...dailyMap.entries()].map(([date, count]) => ({ date, count })),
        byList,
      },
      previous: {
        completedTasks: prevCompletedTasks.length,
        completionRate: prevCompletionRate,
      },
      range: {
        type: range,
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        timezone,
      },
    })
  } catch (error) {
    next(error)
  }
})

export default router
