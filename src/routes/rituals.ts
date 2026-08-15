import { Router, type Request, type Response, type NextFunction } from 'express'
import type { Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../lib/prisma.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { CloseDaySchema, DailyRitualSchema, parseBody } from '../lib/validation.js'
import { isValidIsoDate } from '../lib/timeZone.js'
import { replaceTaskNotificationSchedules } from '../services/taskNotificationService.js'
import { rollForwardRecurringTask } from '../services/taskRecurrenceService.js'

const router = Router()

type RitualRecord = {
  type: 'morning' | 'evening'
  outcome: string | null
  payload: Prisma.JsonValue
}

function ritualType(value: string): 'morning' | 'evening' {
  if (value === 'morning' || value === 'evening') return value
  throw new NotFoundError('Ritual', value)
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function parseDate(value: unknown): string {
  if (typeof value !== 'string' || !isValidIsoDate(value)) {
    throw new ValidationError('date must be a valid YYYY-MM-DD value')
  }
  return value
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function combinedState(date: string, records: RitualRecord[]) {
  const morning = records.find(record => record.type === 'morning')
  const evening = records.find(record => record.type === 'evening')
  const morningPayload = jsonObject(morning?.payload)
  const eveningPayload = jsonObject(evening?.payload)

  return {
    date,
    ...(morning?.outcome != null ? { outcome: morning.outcome } : {}),
    acceptedWindows: Array.isArray(morningPayload.acceptedWindows)
      ? morningPayload.acceptedWindows
      : [],
    planCompleted: morningPayload.planCompleted === true,
    taskDecisions: jsonObject(eveningPayload.taskDecisions as Prisma.JsonValue),
    shutdownCompleted: eveningPayload.shutdownCompleted === true,
  }
}

async function readCombinedState(userId: string, date: string) {
  const records = await getPrisma().dailyRitual.findMany({
    where: { userId, date: dateOnly(date) },
    select: { type: true, outcome: true, payload: true },
  })
  return combinedState(date, records)
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = parseDate(req.query.date)
    res.json(await readCombinedState(req.userId!, date))
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(DailyRitualSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const {
      date,
      outcome,
      acceptedWindows,
      planCompleted,
      taskDecisions,
      shutdownCompleted,
    } = parsed.data
    const prisma = getPrisma()

    await prisma.$transaction(async transaction => {
      if (outcome !== undefined || acceptedWindows !== undefined || planCompleted !== undefined) {
        const current = await transaction.dailyRitual.findUnique({
          where: { userId_date_type: { userId: req.userId!, date: dateOnly(date), type: 'morning' } },
          select: { payload: true },
        })
        const payload = {
          ...jsonObject(current?.payload),
          ...(acceptedWindows !== undefined ? { acceptedWindows } : {}),
          ...(planCompleted !== undefined ? { planCompleted } : {}),
        }
        await transaction.dailyRitual.upsert({
          where: { userId_date_type: { userId: req.userId!, date: dateOnly(date), type: 'morning' } },
          update: {
            ...(outcome !== undefined ? { outcome } : {}),
            payload: payload as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
          create: {
            userId: req.userId!,
            date: dateOnly(date),
            type: 'morning',
            outcome,
            payload: payload as Prisma.InputJsonValue,
          },
        })
      }

      if (taskDecisions !== undefined || shutdownCompleted !== undefined) {
        if (shutdownCompleted === true) {
          throw new ValidationError('Use /api/rituals/close-day to complete shutdown atomically')
        }
        const current = await transaction.dailyRitual.findUnique({
          where: { userId_date_type: { userId: req.userId!, date: dateOnly(date), type: 'evening' } },
          select: { payload: true },
        })
        const payload = {
          ...jsonObject(current?.payload),
          ...(taskDecisions !== undefined ? { taskDecisions } : {}),
          ...(shutdownCompleted !== undefined ? { shutdownCompleted } : {}),
        }
        await transaction.dailyRitual.upsert({
          where: { userId_date_type: { userId: req.userId!, date: dateOnly(date), type: 'evening' } },
          update: { payload: payload as Prisma.InputJsonValue, completedAt: new Date() },
          create: {
            userId: req.userId!,
            date: dateOnly(date),
            type: 'evening',
            payload: payload as Prisma.InputJsonValue,
          },
        })
      }
    })

    res.json(await readCombinedState(req.userId!, date))
  } catch (error) {
    next(error)
  }
})

router.post('/close-day', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CloseDaySchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const { date, commandId, decisions } = parsed.data
    const prisma = getPrisma()

    await prisma.$transaction(async transaction => {
      const ritualKey = {
        userId: req.userId!,
        date: dateOnly(date),
        type: 'evening' as const,
      }
      const current = await transaction.dailyRitual.findUnique({
        where: { userId_date_type: ritualKey },
        select: { payload: true },
      })
      const currentPayload = jsonObject(current?.payload)
      if (currentPayload.shutdownCompleted === true) {
        if (currentPayload.shutdownCommandId === commandId) return
        throw new ValidationError('This day is already closed; reopen it before submitting new decisions')
      }

      const taskIds = decisions.map(decision => decision.taskId)
      const tasks = await transaction.task.findMany({
        where: { userId: req.userId!, id: { in: taskIds } },
        include: { reminders: true },
      })
      const tasksById = new Map(tasks.map(task => [task.id, task]))
      const missingTaskId = taskIds.find(taskId => !tasksById.has(taskId))
      if (missingTaskId) throw new NotFoundError('Task', missingTaskId)

      for (const decision of decisions) {
        const data: Prisma.TaskUpdateInput = decision.action === 'complete'
          ? { status: 'done', completedAt: new Date() }
          : decision.action === 'drop'
            ? { status: 'dropped' }
            : decision.action === 'unschedule'
              ? { scheduledStart: null, scheduledEnd: null }
              : {
                  scheduledStart: new Date(decision.scheduledStart!),
                  scheduledEnd: new Date(decision.scheduledEnd!),
                }
        const task = await transaction.task.update({
          where: { id: decision.taskId },
          data,
          include: { reminders: true },
        })
        await replaceTaskNotificationSchedules(req.userId!, task, transaction)
        if (decision.action === 'complete') {
          await rollForwardRecurringTask(req.userId!, task, transaction)
        }
      }

      const taskDecisions = Object.fromEntries(
        decisions.map(decision => [decision.taskId, decision.action]),
      )
      const payload = {
        ...currentPayload,
        taskDecisions,
        shutdownCompleted: true,
        shutdownCommandId: commandId,
      }
      await transaction.dailyRitual.upsert({
        where: { userId_date_type: ritualKey },
        update: { payload: payload as Prisma.InputJsonValue, completedAt: new Date() },
        create: {
          ...ritualKey,
          payload: payload as Prisma.InputJsonValue,
        },
      })
    }, { isolationLevel: 'Serializable' })

    res.json(await readCombinedState(req.userId!, date))
  } catch (error) {
    next(error)
  }
})

// Type-specific compatibility endpoints for mobile clients.
router.get('/:type', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const type = ritualType(req.params.type)
    const date = parseDate(req.query.date)
    const record = await getPrisma().dailyRitual.findUnique({
      where: { userId_date_type: { userId: req.userId!, date: dateOnly(date), type } },
    })
    res.json(record ? { ...record, _id: record.id, id: undefined } : null)
  } catch (error) {
    next(error)
  }
})

router.put('/:type', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const type = ritualType(req.params.type)
    const parsed = parseBody(DailyRitualSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const { date, outcome, decisions = [], ...payload } = parsed.data
    if (type === 'evening' && decisions.length) {
      throw new ValidationError('Use /api/rituals/close-day to apply task decisions atomically')
    }
    const record = await getPrisma().dailyRitual.upsert({
      where: { userId_date_type: { userId: req.userId!, date: dateOnly(date), type } },
      update: {
        outcome,
        payload: { ...payload, decisions } as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
      create: {
        userId: req.userId!,
        date: dateOnly(date),
        type,
        outcome,
        payload: { ...payload, decisions } as Prisma.InputJsonValue,
      },
    })
    const { id, ...rest } = record
    res.json({ ...rest, _id: id })
  } catch (error) {
    next(error)
  }
})

export default router
