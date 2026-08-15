import { Router, type NextFunction, type Request, type Response } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { ValidationError } from '../lib/errors.js'
import { localDateKey, utcBoundsForLocalDate } from '../lib/timeZone.js'

const router = Router()

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

router.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 7))
    const timezone = typeof req.query.timezone === 'string'
      ? req.query.timezone
      : typeof req.headers['x-timezone'] === 'string'
        ? req.headers['x-timezone']
        : 'UTC'
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

    // Keep adapter calls sequential; concurrent calls have produced PostgreSQL
    // protocol errors with the production driver adapter.
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
        _sum: { durationSeconds: true },
        _count: { id: true },
      })
    const focusRecords = await prisma.focusRecord.findMany({
        where: { userId: req.userId!, deletedAt: null, startTime: { gte: since } },
        select: { startTime: true, durationSeconds: true },
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

    const daily = new Map<string, { date: string; tasks: number; focusMinutes: number; habits: number }>()
    for (let offset = 0; offset < days; offset += 1) {
      const key = addDays(firstDay, offset)
      daily.set(key, { date: key, tasks: 0, focusMinutes: 0, habits: 0 })
    }
    for (const task of completedTasks) {
      if (!task.completedAt) continue
      const entry = daily.get(localDateKey(task.completedAt, timezone))
      if (entry) entry.tasks += 1
    }
    for (const record of focusRecords) {
      const entry = daily.get(localDateKey(record.startTime, timezone))
      if (entry) entry.focusMinutes += Math.round(record.durationSeconds / 60)
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
      daily: [...daily.values()],
    })
  } catch (error) {
    next(error)
  }
})

export default router
