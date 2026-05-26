import { Router, type Request, type Response, type NextFunction } from 'express'
import TaskModel from '../models/Task.js'
import HabitModel from '../models/Habit.js'
import { CreateHabitSchema, UpdateHabitSchema, HabitCheckinSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { computeStreak, computeBestStreak, isDueToday, getCompletionRate } from '../services/streakService.js'

const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

// GET /habits
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const habits = await TaskModel.find({ userId, isHabit: true }).sort({ order: 1, createdAt: -1 }).lean() as LeanDoc[]
    res.json(habits.map(h => ({ ...h, _id: String(h._id) })))
  } catch (err) { next(err) }
})

// POST /habits
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const parsed = parseBody(CreateHabitSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const data = parsed.data as Record<string, unknown>
    const habit = await TaskModel.create({
      userId, title: data.name, isHabit: true, status: 'todo',
      habitGoalType: 'binary', habitIcon: data.icon, habitColor: data.color,
      habitFrequency: { type: data.frequency || 'daily', daysOfWeek: data.customDays },
      completions: [], streakCurrent: 0, streakBest: 0,
      activities: [{ action: 'created', detail: 'Habit created', timestamp: new Date() }],
    })
    const plain = habit.toObject() as LeanDoc
    res.status(201).json({ ...plain, _id: String(plain._id) })
  } catch (err) { next(err) }
})

// GET /habits/today
router.get('/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const habits = await TaskModel.find({ userId, isHabit: true }).lean() as LeanDoc[]
    const today = new Date().toISOString().split('T')[0]

    const result = habits.filter(h => isDueToday(h as any)).map(h => {
      const completions = (h.completions as any[]) || []
      const todayEntry = completions.find((c: any) => c.date === today)
      return {
        ...h, _id: String(h._id),
        streakCurrent: computeStreak(h as any),
        todayStatus: todayEntry?.status || null,
      }
    })
    res.json(result)
  } catch (err) { next(err) }
})

// GET /habits/stats
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const habits = await TaskModel.find({ userId, isHabit: true }).lean() as LeanDoc[]

    const stats = habits.map(h => ({
      _id: String(h._id), title: h.title,
      streakCurrent: computeStreak(h as any),
      streakBest: computeBestStreak(h as any),
      completionRate30d: getCompletionRate(h as any, 30),
    }))
    res.json(stats)
  } catch (err) { next(err) }
})

// GET /habits/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const habit = await TaskModel.findOne({ _id: req.params.id, userId, isHabit: true }).lean() as LeanDoc | null
    if (!habit) throw new NotFoundError('Habit', req.params.id)
    res.json({ ...habit, _id: String(habit._id) })
  } catch (err) { next(err) }
})

// PUT /habits/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const parsed = parseBody(UpdateHabitSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const habit = await TaskModel.findOneAndUpdate({ _id: req.params.id, userId, isHabit: true }, { $set: parsed.data }, { new: true }).lean() as LeanDoc | null
    if (!habit) throw new NotFoundError('Habit', req.params.id)
    res.json({ ...habit, _id: String(habit._id) })
  } catch (err) { next(err) }
})

// DELETE /habits/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    await TaskModel.findOneAndDelete({ _id: req.params.id, userId, isHabit: true })
    res.json({ success: true })
  } catch (err) { next(err) }
})

// POST /habits/:id/checkin
router.post('/:id/checkin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const parsed = parseBody(HabitCheckinSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const { date, status, value, reason } = parsed.data as any
    const habit = await TaskModel.findOne({ _id: req.params.id, userId, isHabit: true }).lean() as LeanDoc | null
    if (!habit) throw new NotFoundError('Habit', req.params.id)

    // Remove existing completion for this date, add new one
    await TaskModel.findOneAndUpdate({ _id: req.params.id, userId }, { $pull: { completions: { date } } })
    const updated = await TaskModel.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $push: { completions: { date, status, value, reason, loggedAt: new Date() } } },
      { new: true },
    ).lean() as LeanDoc | null

    // Recompute streaks
    const streak = computeStreak(updated as any)
    const best = computeBestStreak(updated as any)
    const final = await TaskModel.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { streakCurrent: streak, streakBest: best, streakLastUpdated: new Date() } },
      { new: true },
    ).lean() as LeanDoc | null

    res.json({ ...final, _id: String(final!._id) })
  } catch (err) { next(err) }
})

// GET /habits/:id/completions
router.get('/:id/completions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const habit = await TaskModel.findOne({ _id: req.params.id, userId, isHabit: true }).select('completions').lean() as LeanDoc | null
    if (!habit) throw new NotFoundError('Habit', req.params.id)
    res.json((habit.completions as any[]) || [])
  } catch (err) { next(err) }
})

export default router
