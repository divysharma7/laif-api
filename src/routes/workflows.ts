import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { CreateWorkflowSchema, UpdateWorkflowSchema, WorkflowColumnSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { getPrisma } from '../lib/prisma.js'
import { Prisma } from '../generated/prisma/client.js'

const router = Router()

type WorkflowWithColumns = Prisma.WorkflowGetPayload<{
  include: { columns: true }
}>

function serializeWorkflow(workflow: WorkflowWithColumns) {
  const { id, columns, ...fields } = workflow
  return {
    ...fields,
    _id: id,
    columns: columns
      .map(({ workflowId: _workflowId, ...column }) => column)
      .sort((a, b) => a.order - b.order),
  }
}

const workflowInclude = {
  columns: { orderBy: { order: 'asc' as const } },
}

async function replaceWorkflowColumns(
  tx: Prisma.TransactionClient,
  workflowId: string,
  columns: z.infer<typeof WorkflowColumnSchema>[],
) {
  const ids = columns.map(column => column.id)
  const conflicting = ids.length
    ? await tx.workflowColumn.findFirst({
        where: { id: { in: ids }, workflowId: { not: workflowId } },
        select: { id: true },
      })
    : null
  if (conflicting) throw new ValidationError(`Workflow column ID is already in use: ${conflicting.id}`)

  await tx.workflowColumn.deleteMany({
    where: { workflowId, ...(ids.length ? { id: { notIn: ids } } : {}) },
  })
  if (!ids.length) return

  // Move current orders out of the incoming range so order swaps stay unique.
  await tx.workflowColumn.updateMany({
    where: { workflowId },
    data: { order: { increment: 1_000_000 } },
  })
  for (const column of columns) {
    await tx.workflowColumn.upsert({
      where: { id: column.id },
      update: {
        title: column.title,
        order: column.order,
        color: column.color,
        wipLimit: column.wipLimit,
      },
      create: { ...column, workflowId },
    })
  }
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workflows = await getPrisma().workflow.findMany({
      where: { ownerId: req.userId!, archived: false },
      include: workflowInclude,
      orderBy: { order: 'asc' },
    })
    res.json(workflows.map(serializeWorkflow))
  } catch (err) { next(err) }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateWorkflowSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const { columns, ...input } = parsed.data
    const workflow = await getPrisma().workflow.create({
      data: {
        ...input,
        owner: { connect: { id: req.userId! } },
        ...(columns !== undefined && { columns: { create: columns } }),
      },
      include: workflowInclude,
    })
    res.status(201).json(serializeWorkflow(workflow))
  } catch (err) { next(err) }
})

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workflow = await getPrisma().workflow.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
      include: workflowInclude,
    })
    if (!workflow) throw new NotFoundError('Workflow', req.params.id)
    res.json(serializeWorkflow(workflow))
  } catch (err) { next(err) }
})

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateWorkflowSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const prisma = getPrisma()
    const ownerId = req.userId!
    const existing = await prisma.workflow.findFirst({
      where: { id: req.params.id, ownerId },
      select: { id: true },
    })
    if (!existing) throw new NotFoundError('Workflow', req.params.id)

    const { columns, ...data } = parsed.data
    const workflow = await prisma.$transaction(async tx => {
      await tx.workflow.update({
        where: { id: existing.id },
        data,
      })
      if (columns !== undefined) {
        await replaceWorkflowColumns(tx, existing.id, columns)
      }
      return tx.workflow.findUniqueOrThrow({
        where: { id: existing.id },
        include: workflowInclude,
      })
    })

    res.json(serializeWorkflow(workflow))
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getPrisma().workflow.deleteMany({
      where: { id: req.params.id, ownerId: req.userId! },
    })
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.post('/:id/columns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(WorkflowColumnSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const prisma = getPrisma()
    const workflow = await prisma.workflow.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
      select: { id: true },
    })
    if (!workflow) throw new NotFoundError('Workflow', req.params.id)

    await prisma.workflowColumn.create({
      data: { ...parsed.data, workflowId: workflow.id },
    })
    const updated = await prisma.workflow.findUniqueOrThrow({
      where: { id: workflow.id },
      include: workflowInclude,
    })
    res.json(serializeWorkflow(updated))
  } catch (err) { next(err) }
})

router.put('/:id/columns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const columns = z.array(WorkflowColumnSchema).parse(req.body)
    const prisma = getPrisma()
    const workflow = await prisma.workflow.findFirst({
      where: { id: req.params.id, ownerId: req.userId! },
      select: { id: true },
    })
    if (!workflow) throw new NotFoundError('Workflow', req.params.id)

    const updated = await prisma.$transaction(async tx => {
      await replaceWorkflowColumns(tx, workflow.id, columns)
      return tx.workflow.findUniqueOrThrow({
        where: { id: workflow.id },
        include: workflowInclude,
      })
    })

    res.json(serializeWorkflow(updated))
  } catch (err) { next(err) }
})

export default router
