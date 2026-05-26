import { Router, type Request, type Response, type NextFunction } from 'express'
import FocusSessionModel from '../models/FocusSession.js'
import TaskModel from '../models/Task.js'
import { CreateFocusSessionSchema, FocusSessionActionSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'

const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

// GET /focus/sessions
router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const { taskId, from, to } = req.query as Record<string, string>
    const filter: Record<string, unknown> = { userId }
    if (taskId) filter.taskId = taskId
    if (from || to) {
      filter.startedAt = {}
      if (from) (filter.startedAt as any).$gte = new Date(from)
      if (to) (filter.startedAt as any).$lte = new Date(to)
    }
    const sessions = await FocusSessionModel.find(filter).sort({ startedAt: -1 }).lean() as LeanDoc[]
    res.json(sessions.map(s => ({ ...s, _id: String(s._id) })))
  } catch (err) { next(err) }
})

// POST /focus/sessions
router.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const parsed = parseBody(CreateFocusSessionSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    // Cancel any existing active session
    await FocusSessionModel.updateMany({ userId, status: 'active' }, { $set: { status: 'cancelled', endedAt: new Date(), endedReason: 'user_cancelled' } })

    let taskTitle: string | null = null
    if (parsed.data.taskId) {
      const task = await TaskModel.findOne({ _id: parsed.data.taskId, userId }).lean() as LeanDoc | null
      if (task) taskTitle = task.title as string
    }

    const session = await FocusSessionModel.create({
      userId, ...parsed.data, startedAt: new Date(), status: 'active', taskTitleSnapshot: taskTitle,
    })
    const plain = session.toObject() as LeanDoc
    res.status(201).json({ ...plain, _id: String(plain._id) })
  } catch (err) { next(err) }
})

// GET /focus/sessions/active
router.get('/sessions/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const session = await FocusSessionModel.findOne({ userId, status: 'active' }).lean() as LeanDoc | null
    res.json(session ? { ...session, _id: String(session._id) } : null)
  } catch (err) { next(err) }
})

// PATCH /focus/sessions/:id
router.patch('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const parsed = parseBody(FocusSessionActionSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const session = await FocusSessionModel.findOne({ _id: req.params.id, userId }).lean() as LeanDoc | null
    if (!session) throw new NotFoundError('FocusSession', req.params.id)

    const { action, additionalMin, endedReason, postSessionNote } = parsed.data as any
    const $set: Record<string, unknown> = {}

    switch (action) {
      case 'pause': $set.pausedAt = new Date(); $set.status = 'active'; break
      case 'resume': {
        if (session.pausedAt) {
          const pausedMs = Date.now() - new Date(session.pausedAt as string).getTime()
          $set.totalPausedMs = ((session.totalPausedMs as number) || 0) + pausedMs
        }
        $set.pausedAt = null; break
      }
      case 'extend': $set.extendedByMin = ((session.extendedByMin as number) || 0) + (additionalMin || 0); break
      case 'complete': case 'cancel': {
        $set.status = action === 'complete' ? 'completed' : 'cancelled'
        $set.endedAt = new Date()
        $set.endedReason = endedReason || (action === 'complete' ? 'user_completed' : 'user_cancelled')
        if (postSessionNote) $set.postSessionNote = postSessionNote
        const startMs = new Date(session.startedAt as string).getTime()
        $set.actualDurationMin = Math.round((Date.now() - startMs - ((session.totalPausedMs as number) || 0)) / 60000)
        break
      }
    }

    const updated = await FocusSessionModel.findOneAndUpdate({ _id: req.params.id, userId }, { $set }, { new: true }).lean() as LeanDoc | null
    res.json({ ...updated, _id: String(updated!._id) })
  } catch (err) { next(err) }
})

// GET /focus/stats
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - weekStart.getDay())

    const [todaySessions, weekSessions, allSessions] = await Promise.all([
      FocusSessionModel.find({ userId, status: 'completed', startedAt: { $gte: todayStart } }).lean(),
      FocusSessionModel.find({ userId, status: 'completed', startedAt: { $gte: weekStart } }).lean(),
      FocusSessionModel.find({ userId, status: 'completed' }).sort({ startedAt: -1 }).limit(100).lean(),
    ])

    const sumMin = (arr: any[]) => arr.reduce((s, x) => s + (x.actualDurationMin || 0), 0)
    res.json({
      today: { sessions: todaySessions.length, totalMin: sumMin(todaySessions) },
      week: { sessions: weekSessions.length, totalMin: sumMin(weekSessions) },
      total: { sessions: allSessions.length, totalMin: sumMin(allSessions) },
      avgSessionMin: allSessions.length ? Math.round(sumMin(allSessions) / allSessions.length) : 0,
    })
  } catch (err) { next(err) }
})

export default router
