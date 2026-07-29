import { Router, type Request, type Response, type NextFunction } from 'express'
import { CreateListSchema, UpdateListSchema, ListBlocksSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { getPrisma } from '../lib/prisma.js'
import { ListType, Prisma } from '../generated/prisma/client.js'

const router = Router()

type ListWithCollaborators = Prisma.ListGetPayload<{
  include: { collaborators: true }
}>

function serializeList(list: ListWithCollaborators) {
  const { id, collaborators, ...fields } = list
  return {
    ...fields,
    _id: id,
    collaborators: collaborators.map(({ listId: _listId, ...collaborator }) => collaborator),
  }
}

function parseListType(value: string | undefined): ListType | undefined {
  if (value === undefined) return undefined
  if (!Object.values(ListType).includes(value as ListType)) {
    throw new ValidationError('type must be standard, habit, or reading')
  }
  return value as ListType
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : value as Prisma.InputJsonValue
}

async function requireOwnedGroup(groupId: string | null | undefined, ownerId: string) {
  if (!groupId) return
  const group = await getPrisma().listGroup.findFirst({
    where: { id: groupId, ownerId },
    select: { id: true },
  })
  if (!group) throw new NotFoundError('ListGroup', groupId)
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lists = await getPrisma().list.findMany({
      where: { ownerId: req.userId!, deletedAt: null },
      include: { collaborators: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json(lists.map(serializeList))
  } catch (err) { next(err) }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateListSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const ownerId = req.userId!
    await requireOwnedGroup(parsed.data.groupId, ownerId)

    const data: Prisma.ListUncheckedCreateInput = {
      ownerId,
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.type !== undefined && { type: parseListType(parsed.data.type) }),
      ...(parsed.data.icon !== undefined && { icon: parsed.data.icon }),
      ...(parsed.data.coverImageUrl !== undefined && { coverImageUrl: parsed.data.coverImageUrl }),
      ...(parsed.data.groupId !== undefined && { groupId: parsed.data.groupId }),
      ...(parsed.data.isInbox !== undefined && { isInbox: parsed.data.isInbox }),
      ...(parsed.data.blocks !== undefined && { blocks: jsonInput(parsed.data.blocks) }),
    }

    const list = await getPrisma().list.create({
      data,
      include: { collaborators: true },
    })
    res.status(201).json(serializeList(list))
  } catch (err) { next(err) }
})

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await getPrisma().list.findFirst({
      where: { id: req.params.id, ownerId: req.userId!, deletedAt: null },
      include: { collaborators: true },
    })
    if (!list) throw new NotFoundError('List', req.params.id)
    res.json(serializeList(list))
  } catch (err) { next(err) }
})

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateListSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const prisma = getPrisma()
    const ownerId = req.userId!
    const existing = await prisma.list.findFirst({
      where: { id: req.params.id, ownerId },
      select: { id: true },
    })
    if (!existing) throw new NotFoundError('List', req.params.id)

    await requireOwnedGroup(parsed.data.groupId, ownerId)

    const { collaborators, ...input } = parsed.data
    const data: Prisma.ListUncheckedUpdateInput = {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.icon !== undefined && { icon: input.icon }),
      ...(input.coverImageUrl !== undefined && { coverImageUrl: input.coverImageUrl }),
      ...(input.pinnedToFavorites !== undefined && { pinnedToFavorites: input.pinnedToFavorites }),
      ...(input.hideCompletedTasks !== undefined && { hideCompletedTasks: input.hideCompletedTasks }),
      ...(input.groupId !== undefined && { groupId: input.groupId }),
      ...(input.isPrivate !== undefined && { isPrivate: input.isPrivate }),
      ...(input.type !== undefined && { type: parseListType(input.type) }),
    }

    const collaboratorIds = collaborators === undefined
      ? undefined
      : [...new Set(collaborators)].filter(userId => userId !== ownerId)

    if (collaboratorIds?.length) {
      const validUsers = await prisma.user.count({ where: { id: { in: collaboratorIds } } })
      if (validUsers !== collaboratorIds.length) {
        throw new ValidationError('One or more collaborators do not exist')
      }
    }

    const list = await prisma.$transaction(async tx => {
      await tx.list.update({ where: { id: req.params.id }, data })
      if (collaboratorIds !== undefined) {
        await tx.listCollaborator.deleteMany({ where: { listId: req.params.id } })
        if (collaboratorIds.length) {
          await tx.listCollaborator.createMany({
            data: collaboratorIds.map(userId => ({
              listId: req.params.id,
              userId,
              role: 'collaborator',
              pending: false,
              acceptedAt: new Date(),
            })),
          })
        }
      }
      return tx.list.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { collaborators: true },
      })
    })

    res.json(serializeList(list))
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    const list = await prisma.list.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
      select: { id: true, isInbox: true },
    })
    if (!list) throw new NotFoundError('List', req.params.id)
    if (list.isInbox) {
      res.status(400).json({ error: 'Cannot delete Inbox' })
      return
    }

    await prisma.list.update({
      where: { id: list.id },
      data: { deletedAt: new Date() },
    })
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.patch('/:id/blocks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(ListBlocksSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const prisma = getPrisma()
    const existing = await prisma.list.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
      select: { id: true },
    })
    if (!existing) throw new NotFoundError('List', req.params.id)

    const list = await prisma.list.update({
      where: { id: existing.id },
      data: { blocks: jsonInput(parsed.data.blocks) },
      include: { collaborators: true },
    })
    res.json(serializeList(list))
  } catch (err) { next(err) }
})

export default router
