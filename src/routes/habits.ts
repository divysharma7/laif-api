import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { CreateHabitSchema, UpdateHabitSchema, HabitCheckinSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { computeStreak, computeBestStreak, isDueToday, getCompletionRate } from '../services/streakService.js'

const router = Router()

const habitInclude = {
  comments: { orderBy: { createdAt: 'asc' as const } },
  reminders: true,
  completions: { orderBy: { date: 'asc' as const } },
  activities: { orderBy: { timestamp: 'asc' as const } },
} as const

type ApiRecord = Record<string, any>

function serializeEmbedded(record: ApiRecord, keepId = false): ApiRecord {
  const { id, taskId: _taskId, ...rest } = record
  return keepId ? { ...rest, id, _id: id } : { ...rest, _id: id }
}

function serializeHabit(habit: ApiRecord): ApiRecord {
  const { id, comments = [], reminders = [], completions = [], activities = [], ...rest } = habit
  return {
    ...rest,
    _id: id,
    comments: comments.map((item: ApiRecord) => serializeEmbedded(item)),
    reminders: reminders.map((item: ApiRecord) => serializeEmbedded(item, true)),
    completions: completions.map((item: ApiRecord) => ({
      ...serializeEmbedded(item),
      date: item.date instanceof Date ? item.date.toISOString().slice(0, 10) : item.date,
    })),
    activities: activities.map((item: ApiRecord) => serializeEmbedded(item)),
  }
}

function habitFrequency(frequency: unknown, customDays: unknown): ApiRecord | undefined {
  if (frequency === undefined && customDays === undefined) return undefined
  return {
    type: frequency || 'custom',
    ...(Array.isArray(customDays) ? { daysOfWeek: customDays } : {}),
  }
}

function habitUpdateData(input: ApiRecord): ApiRecord {
  const data: ApiRecord = {}
  if (input.name !== undefined) data.title = input.name
  if (input.description !== undefined) data.description = input.description
  if (input.color !== undefined) data.habitColor = input.color
  if (input.icon !== undefined) data.habitIcon = input.icon
  if (input.order !== undefined) data.order = input.order
  if (input.archived !== undefined) data.status = input.archived ? 'dropped' : 'todo'
  const frequency = habitFrequency(input.frequency, input.customDays)
  if (frequency !== undefined) data.habitFrequency = frequency
  return data
}

async function findOwnedHabit(id: string, userId: string) {
  return getPrisma().task.findFirst({
    where: { id, userId, isHabit: true },
    include: habitInclude,
  })
}

// GET /habits
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const habits = await getPrisma().task.findMany({
      where: { userId: req.userId!, isHabit: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      include: habitInclude,
    })
    res.json(habits.map(serializeHabit))
  } catch (err) { next(err) }
})

// POST /habits
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateHabitSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const input = parsed.data as ApiRecord
    const habit = await getPrisma().task.create({
      data: {
        userId: req.userId!,
        title: input.name,
        description: input.description,
        isHabit: true,
        status: 'todo',
        order: input.order,
        habitGoalType: 'binary',
        habitIcon: input.icon,
        habitColor: input.color,
        habitFrequency: habitFrequency(input.frequency || 'daily', input.customDays),
        streakCurrent: 0,
        streakBest: 0,
        activities: {
          create: { action: 'created', detail: 'Habit created', timestamp: new Date() },
        },
      } as any,
      include: habitInclude,
    })
    res.status(201).json(serializeHabit(habit))
  } catch (err) { next(err) }
})

// GET /habits/today
router.get('/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const habits = await getPrisma().task.findMany({
      where: { userId: req.userId!, isHabit: true },
      include: habitInclude,
    })
    const today = new Date().toISOString().split('T')[0]

    const result = habits.map(serializeHabit).filter(habit => isDueToday(habit)).map(habit => {
      const todayEntry = habit.completions.find((completion: ApiRecord) => completion.date === today)
      return {
        ...habit,
        streakCurrent: computeStreak(habit),
        todayStatus: todayEntry?.status || null,
      }
    })
    res.json(result)
  } catch (err) { next(err) }
})

// GET /habits/stats
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const habits = await getPrisma().task.findMany({
      where: { userId: req.userId!, isHabit: true },
      include: habitInclude,
    })
    const stats = habits.map(serializeHabit).map(habit => ({
      _id: habit._id,
      title: habit.title,
      streakCurrent: computeStreak(habit),
      streakBest: computeBestStreak(habit),
      completionRate30d: getCompletionRate(habit, 30),
    }))
    res.json(stats)
  } catch (err) { next(err) }
})

// GET /habits/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const habit = await findOwnedHabit(req.params.id, req.userId!)
    if (!habit) throw new NotFoundError('Habit', req.params.id)
    res.json(serializeHabit(habit))
  } catch (err) { next(err) }
})

// PUT /habits/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateHabitSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const prisma = getPrisma()
    const habit = await prisma.$transaction(async (tx) => {
      const existing = await tx.task.findFirst({
        where: { id: req.params.id, userId: req.userId!, isHabit: true },
        select: { id: true },
      })
      if (!existing) throw new NotFoundError('Habit', req.params.id)
      return tx.task.update({
        where: { id: existing.id },
        data: habitUpdateData(parsed.data as ApiRecord) as any,
        include: habitInclude,
      })
    })
    res.json(serializeHabit(habit))
  } catch (err) { next(err) }
})

// DELETE /habits/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getPrisma().task.deleteMany({
      where: { id: req.params.id, userId: req.userId!, isHabit: true },
    })
    res.json({ success: true })
  } catch (err) { next(err) }
})

// POST /habits/:id/checkin
router.post('/:id/checkin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(HabitCheckinSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const { date, status, value, reason } = parsed.data
    const completionDate = new Date(`${date}T00:00:00.000Z`)
    const prisma = getPrisma()
    const final = await prisma.$transaction(async (tx) => {
      const habit = await tx.task.findFirst({
        where: { id: req.params.id, userId: req.userId!, isHabit: true },
        select: { id: true },
      })
      if (!habit) throw new NotFoundError('Habit', req.params.id)

      await tx.habitCompletion.upsert({
        where: { taskId_date: { taskId: habit.id, date: completionDate } },
        create: {
          taskId: habit.id,
          date: completionDate,
          status,
          value: value ?? null,
          reason: reason ?? null,
          loggedAt: new Date(),
        },
        update: {
          status,
          value: value ?? null,
          reason: reason ?? null,
          loggedAt: new Date(),
        },
      })

      const updated = await tx.task.findUniqueOrThrow({
        where: { id: habit.id },
        include: habitInclude,
      })
      const apiHabit = serializeHabit(updated)
      const streakCurrent = computeStreak(apiHabit)
      const streakBest = computeBestStreak(apiHabit)

      return tx.task.update({
        where: { id: habit.id },
        data: { streakCurrent, streakBest, streakLastUpdated: new Date() },
        include: habitInclude,
      })
    })

    res.json(serializeHabit(final))
  } catch (err) { next(err) }
})

// GET /habits/:id/completions
router.get('/:id/completions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const habit = await findOwnedHabit(req.params.id, req.userId!)
    if (!habit) throw new NotFoundError('Habit', req.params.id)
    res.json(serializeHabit(habit).completions)
  } catch (err) { next(err) }
})

export default router
