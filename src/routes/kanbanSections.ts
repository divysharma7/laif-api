import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { CreateKanbanSectionSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { getPrisma } from '../lib/prisma.js'

const router = Router()

const UpdateKanbanSectionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  order: z.number().int().min(0).optional(),
})

function serializeKanbanSection<T extends { id: string }>(section: T) {
  const { id, ...fields } = section
  return { ...fields, _id: id }
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sections = await getPrisma().kanbanSection.findMany({
      where: { userId: req.userId! },
      orderBy: { order: 'asc' },
    })
    res.json(sections.map(serializeKanbanSection))
  } catch (err) { next(err) }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateKanbanSectionSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const prisma = getPrisma()
    const userId = req.userId!
    const count = await prisma.kanbanSection.count({ where: { userId } })
    const section = await prisma.kanbanSection.create({
      data: { ...parsed.data, userId, order: count },
    })
    res.status(201).json(serializeKanbanSection(section))
  } catch (err) { next(err) }
})

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateKanbanSectionSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const prisma = getPrisma()
    const existing = await prisma.kanbanSection.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      select: { id: true },
    })
    if (!existing) throw new NotFoundError('KanbanSection', req.params.id)

    const section = await prisma.kanbanSection.update({
      where: { id: existing.id },
      data: parsed.data,
    })
    res.json(serializeKanbanSection(section))
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    const userId = req.userId!

    // Preserve idempotent delete behavior and scope both detachment and
    // deletion to the authenticated user.
    await prisma.$transaction([
      prisma.task.updateMany({
        where: { sectionId: req.params.id, userId },
        data: { sectionId: null },
      }),
      prisma.kanbanSection.deleteMany({
        where: { id: req.params.id, userId },
      }),
    ])

    res.json({ success: true })
  } catch (err) { next(err) }
})

export default router
