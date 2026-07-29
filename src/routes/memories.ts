import { Router, type Request, type Response, type NextFunction } from 'express'
import { MemoryType, TaskPriority, type Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../lib/prisma.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'

const router = Router()

function serializeMemory<T extends { id: string }>(memory: T) {
  const { id, ...rest } = memory
  return { ...rest, _id: id }
}

function memoryData(body: Record<string, unknown>, partial = false): Prisma.MemoryUncheckedCreateInput | Prisma.MemoryUncheckedUpdateInput {
  const data: Record<string, unknown> = {}
  if (typeof body.type === 'string' && Object.values(MemoryType).includes(body.type as MemoryType)) data.type = body.type
  if (typeof body.title === 'string') data.title = body.title
  if (body.description === null || typeof body.description === 'string') data.description = body.description
  if (body.attributes && typeof body.attributes === 'object') data.attributes = body.attributes as Prisma.InputJsonValue
  if (body.status === null || typeof body.status === 'string') data.status = body.status
  if (body.priority === null || (typeof body.priority === 'string' && Object.values(TaskPriority).includes(body.priority as TaskPriority))) data.priority = body.priority
  if (Array.isArray(body.tags) && body.tags.every(tag => typeof tag === 'string')) data.tags = body.tags
  if (body.linkedTaskId === null || typeof body.linkedTaskId === 'string') data.linkedTaskId = body.linkedTaskId
  if (!partial && (!data.type || !data.title)) throw new ValidationError('type and title are required')
  return data as Prisma.MemoryUncheckedCreateInput | Prisma.MemoryUncheckedUpdateInput
}

async function validateLinkedTask(userId: string, linkedTaskId: unknown) {
  if (typeof linkedTaskId !== 'string' || !linkedTaskId) return
  const task = await getPrisma().task.findFirst({
    where: { id: linkedTaskId, userId },
    select: { id: true },
  })
  if (!task) throw new NotFoundError('Task', linkedTaskId)
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const memories = await getPrisma().memory.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
    })
    res.json(memories.map(serializeMemory))
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {}
    await validateLinkedTask(req.userId!, body.linkedTaskId)
    const data = memoryData(body) as Prisma.MemoryUncheckedCreateInput
    const memory = await getPrisma().memory.create({
      data: { ...data, userId: req.userId! },
    })
    res.status(201).json(serializeMemory(memory))
  } catch (err) {
    next(err)
  }
})

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    const existing = await prisma.memory.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      select: { id: true },
    })
    if (!existing) throw new NotFoundError('Memory', req.params.id)
    await validateLinkedTask(req.userId!, req.body?.linkedTaskId)
    const memory = await prisma.memory.update({
      where: { id: existing.id },
      data: memoryData(req.body ?? {}, true) as Prisma.MemoryUncheckedUpdateInput,
    })
    res.json(serializeMemory(memory))
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getPrisma().memory.deleteMany({
      where: { id: req.params.id, userId: req.userId! },
    })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router
