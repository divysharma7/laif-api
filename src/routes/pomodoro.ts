import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { CreatePomodoroSchema, UpdatePomodoroSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'

const router = Router()

type ApiRecord = Record<string, unknown> & { id: string }

function serializeSession(value: ApiRecord): Record<string, unknown> {
  const { id, ...rest } = value
  return { ...rest, _id: id }
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const since = new Date()
    since.setDate(since.getDate() - 7)
    const sessions = await getPrisma().pomodoroSession.findMany({
      where: { userId: req.userId!, startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
    })
    res.json(sessions.map(serializeSession))
  } catch (err) { next(err) }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreatePomodoroSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const prisma = getPrisma()
    const userId = req.userId!
    const session = await prisma.$transaction(async (transaction) => {
      if (parsed.data.taskId) {
        const task = await transaction.task.findFirst({
          where: { id: parsed.data.taskId, userId },
          select: { id: true },
        })
        if (!task) throw new NotFoundError('Task', parsed.data.taskId)
      }
      return transaction.pomodoroSession.create({
        data: {
          userId,
          taskId: parsed.data.taskId,
          taskTitle: parsed.data.taskTitle,
          type: parsed.data.type,
          duration: parsed.data.duration,
          startedAt: new Date(parsed.data.startedAt),
        },
      })
    })
    res.status(201).json(serializeSession(session))
  } catch (err) { next(err) }
})

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdatePomodoroSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const prisma = getPrisma()
    const update = await prisma.pomodoroSession.updateMany({
      where: { id: req.params.id, userId: req.userId! },
      data: {
        completedAt: parsed.data.completedAt === undefined
          ? undefined
          : parsed.data.completedAt
            ? new Date(parsed.data.completedAt)
            : null,
        completed: parsed.data.completed,
      },
    })
    if (update.count === 0) throw new NotFoundError('PomodoroSession', req.params.id)
    const session = await prisma.pomodoroSession.findUnique({
      where: { id: req.params.id },
    })
    if (!session) throw new NotFoundError('PomodoroSession', req.params.id)
    res.json(serializeSession(session))
  } catch (err) { next(err) }
})

export default router
