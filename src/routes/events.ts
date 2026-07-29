import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { CreateEventSchema, UpdateEventSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'

const router = Router()

type ApiRecord = Record<string, unknown> & { id: string }

function serializeEvent(value: ApiRecord): Record<string, unknown> {
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

function validDate(value: string, field: string): Date {
  const result = new Date(value)
  if (Number.isNaN(result.getTime())) throw new ValidationError(`${field} must be a valid date`)
  return result
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const events = await getPrisma().event.findMany({
      where: { userId: req.userId! },
      orderBy: { startDate: 'asc' },
      include: commentsInclude,
    })
    res.json(events.map(serializeEvent))
  } catch (err) { next(err) }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateEventSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const input = parsed.data
    const startDate = validDate(input.startDate, 'startDate')
    const endDate = input.endDate ? validDate(input.endDate, 'endDate') : startDate
    if (endDate < startDate) throw new ValidationError('endDate must not be before startDate')
    const event = await getPrisma().event.create({
      data: {
        userId: req.userId!,
        title: input.title,
        description: input.description,
        startDate,
        endDate,
        allDay: input.allDay,
        color: input.color,
        location: input.location,
      },
      include: commentsInclude,
    })
    res.status(201).json(serializeEvent(event))
  } catch (err) { next(err) }
})

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateEventSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const input = parsed.data
    const prisma = getPrisma()
    const existing = await prisma.event.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      select: { id: true, startDate: true, endDate: true },
    })
    if (!existing) throw new NotFoundError('Event', req.params.id)
    const startDate = input.startDate === undefined
      ? existing.startDate
      : validDate(input.startDate, 'startDate')
    const endDate = input.endDate === undefined
      ? existing.endDate
      : input.endDate
        ? validDate(input.endDate, 'endDate')
        : startDate
    if (endDate < startDate) throw new ValidationError('endDate must not be before startDate')

    await prisma.event.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        description: input.description,
        startDate: input.startDate === undefined ? undefined : startDate,
        endDate: input.endDate === undefined ? undefined : endDate,
        allDay: input.allDay,
        color: input.color,
        location: input.location,
      },
    })
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: commentsInclude,
    })
    if (!event) throw new NotFoundError('Event', req.params.id)
    res.json(serializeEvent(event))
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getPrisma().event.deleteMany({
      where: { id: req.params.id, userId: req.userId! },
    })
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.post('/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body
    if (!text) { res.status(400).json({ error: 'Comment text required' }); return }

    const prisma = getPrisma()
    const event = await prisma.$transaction(async (transaction) => {
      const ownedEvent = await transaction.event.findFirst({
        where: { id: req.params.id, userId: req.userId! },
        select: { id: true },
      })
      if (!ownedEvent) throw new NotFoundError('Event', req.params.id)
      await transaction.eventComment.create({
        data: { eventId: ownedEvent.id, text },
      })
      return transaction.event.findUnique({
        where: { id: ownedEvent.id },
        include: commentsInclude,
      })
    })
    if (!event) throw new NotFoundError('Event', req.params.id)
    res.json(serializeEvent(event))
  } catch (err) { next(err) }
})

export default router
