import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { CreateTaskSchema, UpdateTaskSchema, TaskScheduleSchema, TaskReorderSchema, TaskReparentSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

const router = Router()

const taskInclude = {
  comments: { orderBy: { createdAt: 'asc' as const } },
  reminders: true,
  completions: { orderBy: { date: 'asc' as const } },
  activities: { orderBy: { timestamp: 'asc' as const } },
} as const

type ApiRecord = Record<string, any>

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2002'
}

function toDatabaseTaskStatus(status: unknown): unknown {
  return status === 'in-progress' ? 'in_progress' : status
}

function toDatabaseReminderType(type: unknown): unknown {
  if (type === 'before-start') return 'before_start'
  if (type === 'on-day-at') return 'on_day_at'
  return type
}

function toApiTaskStatus(status: unknown): unknown {
  return status === 'in_progress' ? 'in-progress' : status
}

function toApiReminderType(type: unknown): unknown {
  if (type === 'before_start') return 'before-start'
  if (type === 'on_day_at') return 'on-day-at'
  return type
}

function serializeEmbedded(record: ApiRecord, keepId = false): ApiRecord {
  const { id, taskId: _taskId, ...rest } = record
  return keepId ? { ...rest, id, _id: id } : { ...rest, _id: id }
}

function serializeTask(task: ApiRecord, includeType = true): ApiRecord {
  const {
    id,
    clientCommandId: _clientCommandId,
    comments = [],
    reminders = [],
    completions = [],
    activities = [],
    ...rest
  } = task
  const serialized = {
    ...rest,
    status: toApiTaskStatus(rest.status),
    _id: id,
    ...(includeType ? { type: 'task' } : {}),
    comments: comments.map((item: ApiRecord) => serializeEmbedded(item)),
    reminders: reminders.map((item: ApiRecord) => ({
      ...serializeEmbedded(item, true),
      type: toApiReminderType(item.type),
    })),
    completions: completions.map((item: ApiRecord) => ({
      ...serializeEmbedded(item),
      date: item.date instanceof Date ? item.date.toISOString().slice(0, 10) : item.date,
    })),
    activities: activities.map((item: ApiRecord) => serializeEmbedded(item)),
  }
  if (serialized.status === undefined) delete serialized.status
  return serialized
}

function optionalDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  return new Date(value as string)
}

function reminderCreates(reminders: unknown): ApiRecord[] | undefined {
  if (!Array.isArray(reminders)) return undefined
  return reminders.map((reminder: ApiRecord) => ({
    id: reminder.id,
    type: toDatabaseReminderType(reminder.type),
    offsetMinutes: reminder.offsetMinutes,
    timeOfDay: reminder.timeOfDay,
    absoluteTime: optionalDate(reminder.absoluteTime),
    sent: reminder.sent,
  }))
}

function taskScalarData(input: ApiRecord): ApiRecord {
  const { reminders: _reminders, ...data } = input
  for (const field of ['dueDate', 'scheduledStart', 'scheduledEnd', 'completedAt']) {
    if (field in data) data[field] = optionalDate(data[field])
  }
  if ('status' in data) data.status = toDatabaseTaskStatus(data.status)
  return data
}

async function validateOwnedRelations(client: ApiRecord, userId: string, data: ApiRecord) {
  if (data.parentId) {
    const parent = await client.task.findFirst({
      where: { id: data.parentId, userId },
      select: { id: true },
    })
    if (!parent) throw new NotFoundError('Parent task', data.parentId)
  }
  if (data.listId) {
    const list = await client.list.findFirst({
      where: { id: data.listId, ownerId: userId },
      select: { id: true },
    })
    if (!list) throw new NotFoundError('List', data.listId)
  }
  if (data.workflowId) {
    const workflow = await client.workflow.findFirst({
      where: { id: data.workflowId, ownerId: userId },
      select: { id: true },
    })
    if (!workflow) throw new NotFoundError('Workflow', data.workflowId)
  }
  if (data.sectionId) {
    const section = await client.workflowColumn.findFirst({
      where: { id: data.sectionId, workflow: { ownerId: userId } },
      select: { id: true },
    })
    if (!section) throw new NotFoundError('Workflow column', data.sectionId)
  }
}

async function findOwnedTask(id: string, userId: string) {
  return getPrisma().task.findFirst({ where: { id, userId }, include: taskInclude })
}

async function updateOwnedTask(
  id: string,
  userId: string,
  input: ApiRecord,
  activity?: { action: string; detail: string; timestamp: Date },
) {
  const prisma = getPrisma()
  return prisma.$transaction(async (tx) => {
    const existing = await tx.task.findFirst({ where: { id, userId }, select: { id: true } })
    if (!existing) throw new NotFoundError('Task', id)
    await validateOwnedRelations(tx, userId, input)

    const reminders = reminderCreates(input.reminders)
    if (reminders) {
      await tx.taskReminder.deleteMany({ where: { taskId: id } })
    }

    return tx.task.update({
      where: { id },
      data: {
        ...taskScalarData(input),
        ...(reminders ? { reminders: { create: reminders } } : {}),
        ...(activity ? { activities: { create: activity } } : {}),
      } as any,
      include: taskInclude,
    })
  })
}

// GET /tasks
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await getPrisma().task.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
      include: taskInclude,
    })
    res.json(tasks.map(task => serializeTask(task)))
  } catch (err) { next(err) }
})

// POST /tasks
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateTaskSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const input = parsed.data as ApiRecord
    const reminders = reminderCreates(input.reminders)
    const prisma = getPrisma()
    let result: { task: ApiRecord; created: boolean }
    try {
      result = await prisma.$transaction(async (tx) => {
        if (input.clientCommandId) {
          const existing = await tx.task.findFirst({
            where: {
              userId: req.userId!,
              clientCommandId: input.clientCommandId,
            },
            include: taskInclude,
          })
          if (existing) return { task: existing, created: false }
        }
        await validateOwnedRelations(tx, req.userId!, input)
        const task = await tx.task.create({
          data: {
            ...taskScalarData(input),
            userId: req.userId!,
            ...(reminders ? { reminders: { create: reminders } } : {}),
            activities: {
              create: { action: 'created', detail: 'Task created', timestamp: new Date() },
            },
          } as any,
          include: taskInclude,
        })
        return { task, created: true }
      })
    } catch (error) {
      if (!input.clientCommandId || !isUniqueConstraintError(error)) throw error
      const task = await prisma.task.findFirst({
        where: {
          userId: req.userId!,
          clientCommandId: input.clientCommandId,
        },
        include: taskInclude,
      })
      if (!task) throw error
      result = { task, created: false }
    }
    if (result.created) {
      logger.debug({ taskId: result.task.id }, 'Task created')
    }
    res.status(result.created ? 201 : 200).json(serializeTask(result.task))
  } catch (err) { next(err) }
})

// GET /tasks/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await findOwnedTask(req.params.id, req.userId!)
    if (!task) throw new NotFoundError('Task', req.params.id)
    res.json(serializeTask(task))
  } catch (err) { next(err) }
})

// PUT /tasks/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateTaskSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const task = await updateOwnedTask(req.params.id, req.userId!, parsed.data as ApiRecord)
    res.json(serializeTask(task))
  } catch (err) { next(err) }
})

// PATCH /tasks/:id
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateTaskSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const data = parsed.data as ApiRecord
    let activity: { action: string; detail: string; timestamp: Date } | undefined
    if (data.status) {
      activity = {
        action: 'status_changed',
        detail: `Status changed to ${data.status}`,
        timestamp: new Date(),
      }
      if (data.status === 'done') data.completedAt = new Date()
    }

    const task = await updateOwnedTask(req.params.id, req.userId!, data, activity)
    res.json(serializeTask(task))
  } catch (err) { next(err) }
})

// DELETE /tasks/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    await prisma.$transaction(async (tx) => {
      const existing = await tx.task.findFirst({
        where: { id: req.params.id, userId: req.userId! },
        select: { id: true },
      })
      if (!existing) throw new NotFoundError('Task', req.params.id)
      await tx.task.deleteMany({ where: { parentId: req.params.id, userId: req.userId! } })
      await tx.task.delete({ where: { id: req.params.id } })
    })
    res.json({ success: true })
  } catch (err) { next(err) }
})

// PATCH /tasks/:id/schedule
router.patch('/:id/schedule', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(TaskScheduleSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const task = await updateOwnedTask(req.params.id, req.userId!, {
      scheduledStart: parsed.data.scheduledStart,
      scheduledEnd: parsed.data.scheduledEnd || null,
    })
    res.json(serializeTask(task))
  } catch (err) { next(err) }
})

// PATCH /tasks/:id/unschedule
router.patch('/:id/unschedule', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await updateOwnedTask(req.params.id, req.userId!, {
      scheduledStart: null,
      scheduledEnd: null,
    })
    res.json(serializeTask(task))
  } catch (err) { next(err) }
})

// POST /tasks/:id/comments
router.post('/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Comment text is required' })
      return
    }

    const prisma = getPrisma()
    const task = await prisma.$transaction(async (tx) => {
      const existing = await tx.task.findFirst({
        where: { id: req.params.id, userId: req.userId! },
        select: { id: true },
      })
      if (!existing) throw new NotFoundError('Task', req.params.id)
      await tx.taskComment.create({ data: { taskId: existing.id, text } })
      return tx.task.findUniqueOrThrow({ where: { id: existing.id }, include: taskInclude })
    })
    res.json(serializeTask(task))
  } catch (err) { next(err) }
})

// POST /tasks/reorder
router.post('/reorder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(TaskReorderSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const { taskId, kanbanOrder, sectionId, status, dueDate } = parsed.data
    const data: ApiRecord = { kanbanOrder }
    if (sectionId !== undefined) data.sectionId = sectionId
    if (status !== undefined) data.status = status
    if (dueDate !== undefined) data.dueDate = dueDate

    const task = await updateOwnedTask(taskId, req.userId!, data)
    res.json(serializeTask(task))
  } catch (err) { next(err) }
})

// PATCH /tasks/:id/indent
router.patch('/:id/indent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    const userId = req.userId!
    const task = await prisma.task.findFirst({ where: { id: req.params.id, userId } })
    if (!task) throw new NotFoundError('Task', req.params.id)

    const siblings = await prisma.task.findMany({
      where: { userId, parentId: task.parentId, id: { not: req.params.id }, order: { lt: task.order } },
      orderBy: { order: 'asc' },
    })
    const previousSibling = siblings.at(-1)
    if (!previousSibling) {
      res.status(400).json({ error: 'No sibling to indent under' })
      return
    }

    const updated = await updateOwnedTask(req.params.id, userId, {
      parentId: previousSibling.id,
      depth: previousSibling.depth + 1,
    })
    res.json(serializeTask(updated))
  } catch (err) { next(err) }
})

// PATCH /tasks/:id/outdent
router.patch('/:id/outdent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    const userId = req.userId!
    const task = await prisma.task.findFirst({ where: { id: req.params.id, userId } })
    if (!task) throw new NotFoundError('Task', req.params.id)
    if (!task.parentId) {
      res.status(400).json({ error: 'Task is already at root level' })
      return
    }

    const parent = await prisma.task.findFirst({ where: { id: task.parentId, userId } })
    const updated = await updateOwnedTask(req.params.id, userId, {
      parentId: parent?.parentId || null,
      depth: Math.max(0, task.depth - 1),
    })
    res.json(serializeTask(updated))
  } catch (err) { next(err) }
})

// PATCH /tasks/:id/reparent
router.patch('/:id/reparent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(TaskReparentSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const { parentId } = parsed.data
    if (parentId === req.params.id) {
      res.status(400).json({ error: 'Cannot set task as its own parent' })
      return
    }

    let depth = 0
    if (parentId) {
      const parent = await getPrisma().task.findFirst({
        where: { id: parentId, userId: req.userId! },
      })
      if (!parent) throw new NotFoundError('Parent task', parentId)
      depth = parent.depth + 1
    }

    const updated = await updateOwnedTask(req.params.id, req.userId!, {
      parentId: parentId || null,
      depth,
    })
    res.json(serializeTask(updated))
  } catch (err) { next(err) }
})

export default router
