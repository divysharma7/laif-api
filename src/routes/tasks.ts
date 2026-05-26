import { Router, type Request, type Response, type NextFunction } from 'express'
import TaskModel from '../models/Task.js'
import { CreateTaskSchema, UpdateTaskSchema, TaskScheduleSchema, TaskReorderSchema, TaskReparentSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

// GET /tasks
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const tasks = await TaskModel.find({ userId }).sort({ createdAt: -1 }).lean() as LeanDoc[]
    res.json(tasks.map(t => ({ ...t, _id: String(t._id), type: 'task' })))
  } catch (err) { next(err) }
})

// POST /tasks
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const parsed = parseBody(CreateTaskSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const task = await TaskModel.create({
      ...parsed.data, userId,
      activities: [{ action: 'created', detail: 'Task created', timestamp: new Date() }],
    })
    const plain = task.toObject() as LeanDoc
    logger.debug({ taskId: String(plain._id) }, 'Task created')
    res.status(201).json({ ...plain, _id: String(plain._id), type: 'task' })
  } catch (err) { next(err) }
})

// GET /tasks/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const task = await TaskModel.findOne({ _id: req.params.id, userId }).lean() as LeanDoc | null
    if (!task) throw new NotFoundError('Task', req.params.id)
    res.json({ ...task, _id: String(task._id), type: 'task' })
  } catch (err) { next(err) }
})

// PUT /tasks/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const parsed = parseBody(UpdateTaskSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const task = await TaskModel.findOneAndUpdate({ _id: req.params.id, userId }, parsed.data, { new: true }).lean() as LeanDoc | null
    if (!task) throw new NotFoundError('Task', req.params.id)
    res.json({ ...task, _id: String(task._id), type: 'task' })
  } catch (err) { next(err) }
})

// PATCH /tasks/:id
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const parsed = parseBody(UpdateTaskSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const data = parsed.data as Record<string, unknown>
    // Build activity entry for status changes
    const activities: unknown[] = []
    if (data.status) {
      activities.push({ action: 'status_changed', detail: `Status changed to ${data.status}`, timestamp: new Date() })
      if (data.status === 'done') data.completedAt = new Date()
    }

    const updateOp: Record<string, unknown> = { $set: data }
    if (activities.length) updateOp.$push = { activities: { $each: activities } }

    const task = await TaskModel.findOneAndUpdate({ _id: req.params.id, userId }, updateOp, { new: true }).lean() as LeanDoc | null
    if (!task) throw new NotFoundError('Task', req.params.id)
    res.json({ ...task, _id: String(task._id), type: 'task' })
  } catch (err) { next(err) }
})

// DELETE /tasks/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const result = await TaskModel.findOneAndDelete({ _id: req.params.id, userId })
    if (!result) throw new NotFoundError('Task', req.params.id)
    // Also delete subtasks
    await TaskModel.deleteMany({ parentId: req.params.id, userId })
    res.json({ success: true })
  } catch (err) { next(err) }
})

// PATCH /tasks/:id/schedule
router.patch('/:id/schedule', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const parsed = parseBody(TaskScheduleSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const task = await TaskModel.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { scheduledStart: parsed.data.scheduledStart, scheduledEnd: parsed.data.scheduledEnd || null } },
      { new: true },
    ).lean() as LeanDoc | null
    if (!task) throw new NotFoundError('Task', req.params.id)
    res.json({ ...task, _id: String(task._id), type: 'task' })
  } catch (err) { next(err) }
})

// PATCH /tasks/:id/unschedule
router.patch('/:id/unschedule', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const task = await TaskModel.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { scheduledStart: null, scheduledEnd: null } },
      { new: true },
    ).lean() as LeanDoc | null
    if (!task) throw new NotFoundError('Task', req.params.id)
    res.json({ ...task, _id: String(task._id), type: 'task' })
  } catch (err) { next(err) }
})

// POST /tasks/:id/comments
router.post('/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const { text } = req.body
    if (!text || typeof text !== 'string') { res.status(400).json({ error: 'Comment text is required' }); return }

    const task = await TaskModel.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $push: { comments: { text, createdAt: new Date() } } },
      { new: true },
    ).lean() as LeanDoc | null
    if (!task) throw new NotFoundError('Task', req.params.id)
    res.json({ ...task, _id: String(task._id), type: 'task' })
  } catch (err) { next(err) }
})

// POST /tasks/reorder
router.post('/reorder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const parsed = parseBody(TaskReorderSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const { taskId, kanbanOrder, sectionId, status, dueDate } = parsed.data as any
    const $set: Record<string, unknown> = { kanbanOrder }
    if (sectionId !== undefined) $set.sectionId = sectionId
    if (status !== undefined) $set.status = status
    if (dueDate !== undefined) $set.dueDate = dueDate

    const task = await TaskModel.findOneAndUpdate({ _id: taskId, userId }, { $set }, { new: true }).lean() as LeanDoc | null
    if (!task) throw new NotFoundError('Task', taskId)
    res.json({ ...task, _id: String(task._id), type: 'task' })
  } catch (err) { next(err) }
})

// PATCH /tasks/:id/indent
router.patch('/:id/indent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const task = await TaskModel.findOne({ _id: req.params.id, userId }).lean() as LeanDoc | null
    if (!task) throw new NotFoundError('Task', req.params.id)

    // Find the previous sibling to become the new parent
    const siblings = await TaskModel.find({ userId, parentId: task.parentId || null, _id: { $ne: req.params.id } })
      .sort({ order: 1 }).lean() as LeanDoc[]
    const prevSibling = siblings.filter(s => (s.order as number) < (task.order as number)).pop()
    if (!prevSibling) { res.status(400).json({ error: 'No sibling to indent under' }); return }

    const updated = await TaskModel.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { parentId: prevSibling._id, depth: ((prevSibling.depth as number) || 0) + 1 } },
      { new: true },
    ).lean() as LeanDoc | null
    res.json({ ...updated, _id: String(updated!._id), type: 'task' })
  } catch (err) { next(err) }
})

// PATCH /tasks/:id/outdent
router.patch('/:id/outdent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const task = await TaskModel.findOne({ _id: req.params.id, userId }).lean() as LeanDoc | null
    if (!task) throw new NotFoundError('Task', req.params.id)
    if (!task.parentId) { res.status(400).json({ error: 'Task is already at root level' }); return }

    const parent = await TaskModel.findOne({ _id: task.parentId, userId }).lean() as LeanDoc | null
    const newParentId = parent?.parentId || null
    const newDepth = Math.max(0, ((task.depth as number) || 1) - 1)

    const updated = await TaskModel.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { parentId: newParentId, depth: newDepth } },
      { new: true },
    ).lean() as LeanDoc | null
    res.json({ ...updated, _id: String(updated!._id), type: 'task' })
  } catch (err) { next(err) }
})

// PATCH /tasks/:id/reparent
router.patch('/:id/reparent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!
    const parsed = parseBody(TaskReparentSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)

    const { parentId } = parsed.data as any
    // Prevent circular reference
    if (parentId === req.params.id) { res.status(400).json({ error: 'Cannot set task as its own parent' }); return }

    let depth = 0
    if (parentId) {
      const parent = await TaskModel.findOne({ _id: parentId, userId }).lean() as LeanDoc | null
      if (!parent) throw new NotFoundError('Parent task', parentId)
      depth = ((parent.depth as number) || 0) + 1
    }

    const updated = await TaskModel.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { parentId: parentId || null, depth } },
      { new: true },
    ).lean() as LeanDoc | null
    if (!updated) throw new NotFoundError('Task', req.params.id)
    res.json({ ...updated, _id: String(updated._id), type: 'task' })
  } catch (err) { next(err) }
})

export default router
