import { Router, type Request, type Response, type NextFunction } from 'express'
import TaskModel from '../models/Task.js'
import EventModel from '../models/Event.js'
import ReminderModel from '../models/Reminder.js'
import FocusSessionModel from '../models/FocusSession.js'
import ExternalCalendarEventModel from '../models/ExternalCalendarEvent.js'

const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const [events, tasks, reminders] = await Promise.all([
      EventModel.find({ userId }).lean() as Promise<LeanDoc[]>,
      TaskModel.find({ userId, dueDate: { $ne: null } }).lean() as Promise<LeanDoc[]>,
      ReminderModel.find({ userId }).lean() as Promise<LeanDoc[]>,
    ])
    const items = [
      ...events.map(e => ({ ...e, _id: String(e._id), itemType: 'event' })),
      ...tasks.map(t => ({ ...t, _id: String(t._id), itemType: 'task' })),
      ...reminders.map(r => ({ ...r, _id: String(r._id), itemType: 'reminder' })),
    ]
    res.json(items)
  } catch (err) { next(err) }
})

router.get('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const { from, to, include } = req.query as Record<string, string>
    const includeSet = new Set((include || 'tasks,habits,google,focus').split(','))
    const results: any[] = []
    const dateFilter: Record<string, unknown> = {}
    if (from) dateFilter.$gte = new Date(from)
    if (to) dateFilter.$lte = new Date(to)

    if (includeSet.has('tasks')) {
      const filter: Record<string, unknown> = { userId, scheduledStart: { $ne: null } }
      if (from || to) filter.scheduledStart = dateFilter
      const tasks = await TaskModel.find(filter).lean() as LeanDoc[]
      results.push(...tasks.map(t => ({ ...t, _id: String(t._id), calendarType: t.isHabit ? 'habit' : 'task' })))
    }
    if (includeSet.has('google')) {
      const filter: Record<string, unknown> = { userId }
      if (from || to) filter.start = dateFilter
      const ext = await ExternalCalendarEventModel.find(filter).lean() as LeanDoc[]
      results.push(...ext.map(e => ({ ...e, _id: String(e._id), calendarType: 'google' })))
    }
    if (includeSet.has('focus')) {
      const filter: Record<string, unknown> = { userId, status: 'completed' }
      if (from || to) filter.startedAt = dateFilter
      const sessions = await FocusSessionModel.find(filter).lean() as LeanDoc[]
      results.push(...sessions.map(s => ({ ...s, _id: String(s._id), calendarType: 'focus' })))
    }
    res.json(results)
  } catch (err) { next(err) }
})

router.get('/unscheduled', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const tasks = await TaskModel.find({ userId, scheduledStart: null, status: { $nin: ['done', 'dropped'] } }).sort({ createdAt: -1 }).lean() as LeanDoc[]
    res.json(tasks.map(t => ({ ...t, _id: String(t._id) })))
  } catch (err) { next(err) }
})

router.get('/overdue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const now = new Date()
    const tasks = await TaskModel.find({ userId, scheduledStart: { $lt: now }, status: { $nin: ['done', 'dropped'] } }).sort({ scheduledStart: 1 }).lean() as LeanDoc[]
    res.json(tasks.map(t => ({ ...t, _id: String(t._id) })))
  } catch (err) { next(err) }
})

router.get('/capacity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const { from, to } = req.query as Record<string, string>
    const filter: Record<string, unknown> = { userId, scheduledStart: { $ne: null } }
    if (from || to) {
      filter.scheduledStart = {}
      if (from) (filter.scheduledStart as any).$gte = new Date(from)
      if (to) (filter.scheduledStart as any).$lte = new Date(to)
    }
    const tasks = await TaskModel.find(filter).lean() as LeanDoc[]
    const byDay: Record<string, number> = {}
    for (const t of tasks) {
      if (!t.scheduledStart) continue
      const day = new Date(t.scheduledStart as string).toISOString().split('T')[0]
      byDay[day] = (byDay[day] || 0) + ((t.estimatedEffort as number) || 0.5)
    }
    res.json(Object.entries(byDay).map(([date, hours]) => ({ date, scheduledHours: hours })))
  } catch (err) { next(err) }
})

router.get('/heatmap', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const tasks = await TaskModel.find({ userId, status: 'done', completedAt: { $ne: null } }).select('completedAt').lean() as LeanDoc[]
    const byDay: Record<string, number> = {}
    for (const t of tasks) {
      if (!t.completedAt) continue
      const day = new Date(t.completedAt as string).toISOString().split('T')[0]
      byDay[day] = (byDay[day] || 0) + 1
    }
    res.json(Object.entries(byDay).map(([date, count]) => ({ date, count })))
  } catch (err) { next(err) }
})

export default router
