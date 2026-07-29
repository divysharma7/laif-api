import { Router, type Request, type Response, type NextFunction } from 'express'
import { CreateListGroupSchema, UpdateListGroupSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { getPrisma } from '../lib/prisma.js'

const router = Router()

function serializeListGroup<T extends { id: string }>(group: T) {
  const { id, ...fields } = group
  return { ...fields, _id: id }
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groups = await getPrisma().listGroup.findMany({
      where: { ownerId: req.userId! },
      orderBy: { order: 'asc' },
    })
    res.json(groups.map(serializeListGroup))
  } catch (err) { next(err) }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateListGroupSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const prisma = getPrisma()
    const ownerId = req.userId!
    const duplicate = await prisma.listGroup.findFirst({
      where: { ownerId, title: parsed.data.title },
      select: { id: true },
    })
    if (duplicate) throw new ValidationError('A list group with this title already exists')

    const count = await prisma.listGroup.count({ where: { ownerId } })
    const group = await prisma.listGroup.create({
      data: { ownerId, title: parsed.data.title, order: count },
    })
    res.status(201).json(serializeListGroup(group))
  } catch (err) { next(err) }
})

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateListGroupSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const prisma = getPrisma()
    const ownerId = req.userId!
    const existing = await prisma.listGroup.findFirst({
      where: { id: req.params.id, ownerId },
      select: { id: true },
    })
    if (!existing) throw new NotFoundError('ListGroup', req.params.id)

    if (parsed.data.title !== undefined) {
      const duplicate = await prisma.listGroup.findFirst({
        where: {
          ownerId,
          title: parsed.data.title,
          id: { not: req.params.id },
        },
        select: { id: true },
      })
      if (duplicate) throw new ValidationError('A list group with this title already exists')
    }

    const group = await prisma.listGroup.update({
      where: { id: existing.id },
      data: parsed.data,
    })
    res.json(serializeListGroup(group))
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    const ownerId = req.userId!

    // Preserve the existing idempotent delete contract while ensuring another
    // user's group can never be mutated.
    await prisma.$transaction([
      prisma.list.updateMany({
        where: { groupId: req.params.id, ownerId },
        data: { groupId: null },
      }),
      prisma.listGroup.deleteMany({
        where: { id: req.params.id, ownerId },
      }),
    ])

    res.json({ success: true })
  } catch (err) { next(err) }
})

export default router
