import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { CreateReminderSchema, UpdateReminderSchema, ReminderSnoozeSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'

const router = Router()

type ApiRecord = Record<string, unknown> & { id: string }

function serializeReminder(value: ApiRecord): Record<string, unknown> {
  const { id, comments, ...rest } = value
  return {
    ...rest,
    ...(Array.isArray(comments)
      ? {
          comments: comments.map((comment) => {
            const { id: commentId, ...commentRest } = comment as ApiRecord
            return { ...commentRest, _id: commentId }
          }),
        }
      : {}),
    _id: id,
  }
}

const commentsInclude = { comments: { orderBy: { createdAt: 'asc' as const } } }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reminders = await getPrisma().reminder.findMany({
      where: { userId: req.userId! },
      orderBy: { reminderDate: 'asc' },
      include: commentsInclude,
    })
    res.json(reminders.map(serializeReminder))
  } catch (err) { next(err) }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateReminderSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const input = parsed.data
    const reminder = await getPrisma().reminder.create({
      data: {
        userId: req.userId!,
        title: input.title,
        description: input.description,
        reminderDate: new Date(input.reminderDate),
        // priority and tags remain accepted for API compatibility.
      },
      include: commentsInclude,
    })
    res.status(201).json(serializeReminder(reminder))
  } catch (err) { next(err) }
})

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateReminderSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const input = parsed.data
    const prisma = getPrisma()
    const update = await prisma.reminder.updateMany({
      where: { id: req.params.id, userId: req.userId! },
      data: {
        title: input.title,
        description: input.description,
        reminderDate: input.reminderDate === undefined ? undefined : new Date(input.reminderDate),
      },
    })
    if (update.count === 0) throw new NotFoundError('Reminder', req.params.id)
    const reminder = await prisma.reminder.findUnique({
      where: { id: req.params.id },
      include: commentsInclude,
    })
    if (!reminder) throw new NotFoundError('Reminder', req.params.id)
    res.json(serializeReminder(reminder))
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getPrisma().reminder.deleteMany({
      where: { id: req.params.id, userId: req.userId! },
    })
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.post('/:id/snooze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(ReminderSnoozeSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const prisma = getPrisma()
    const reminderDate = new Date(Date.now() + parsed.data.snoozeMinutes * 60000)
    const update = await prisma.reminder.updateMany({
      where: { id: req.params.id, userId: req.userId! },
      data: { reminderDate, notified: false },
    })
    if (update.count === 0) throw new NotFoundError('Reminder', req.params.id)
    const reminder = await prisma.reminder.findUnique({
      where: { id: req.params.id },
      include: commentsInclude,
    })
    if (!reminder) throw new NotFoundError('Reminder', req.params.id)
    res.json(serializeReminder(reminder))
  } catch (err) { next(err) }
})

router.post('/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body
    if (!text) { res.status(400).json({ error: 'Comment text required' }); return }

    const prisma = getPrisma()
    const reminder = await prisma.$transaction(async (transaction) => {
      const ownedReminder = await transaction.reminder.findFirst({
        where: { id: req.params.id, userId: req.userId! },
        select: { id: true },
      })
      if (!ownedReminder) throw new NotFoundError('Reminder', req.params.id)
      await transaction.reminderComment.create({
        data: { reminderId: ownedReminder.id, text },
      })
      return transaction.reminder.findUnique({
        where: { id: ownedReminder.id },
        include: commentsInclude,
      })
    })
    if (!reminder) throw new NotFoundError('Reminder', req.params.id)
    res.json(serializeReminder(reminder))
  } catch (err) { next(err) }
})

export default router
