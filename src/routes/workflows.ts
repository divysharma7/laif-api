import { Router, type Request, type Response, type NextFunction } from 'express'
import WorkflowModel from '../models/Workflow.js'
import { CreateWorkflowSchema, UpdateWorkflowSchema, WorkflowColumnSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
import { z } from 'zod'

const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wfs = await WorkflowModel.find({ ownerId: req.userId!, archived: { $ne: true } }).sort({ order: 1 }).lean() as LeanDoc[]
    res.json(wfs.map(w => ({ ...w, _id: String(w._id) })))
  } catch (err) { next(err) }
})
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateWorkflowSchema, req.body); if (!parsed.success) throw new ValidationError(parsed.error)
    const wf = await WorkflowModel.create({ ...(parsed.data as any), ownerId: req.userId! })
    res.status(201).json({ ...wf.toObject(), _id: String(wf._id) })
  } catch (err) { next(err) }
})
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wf = await WorkflowModel.findOne({ _id: req.params.id, ownerId: req.userId! }).lean() as LeanDoc | null
    if (!wf) throw new NotFoundError('Workflow', req.params.id)
    res.json({ ...wf, _id: String(wf._id) })
  } catch (err) { next(err) }
})
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateWorkflowSchema, req.body); if (!parsed.success) throw new ValidationError(parsed.error)
    const wf = await WorkflowModel.findOneAndUpdate({ _id: req.params.id, ownerId: req.userId! }, { $set: parsed.data }, { new: true }).lean() as LeanDoc | null
    if (!wf) throw new NotFoundError('Workflow', req.params.id)
    res.json({ ...wf, _id: String(wf._id) })
  } catch (err) { next(err) }
})
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await WorkflowModel.findOneAndDelete({ _id: req.params.id, ownerId: req.userId! })
    res.json({ success: true })
  } catch (err) { next(err) }
})
router.post('/:id/columns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(WorkflowColumnSchema, req.body); if (!parsed.success) throw new ValidationError(parsed.error)
    const wf = await WorkflowModel.findOneAndUpdate({ _id: req.params.id, ownerId: req.userId! }, { $push: { columns: parsed.data } }, { new: true }).lean() as LeanDoc | null
    if (!wf) throw new NotFoundError('Workflow', req.params.id)
    res.json({ ...wf, _id: String(wf._id) })
  } catch (err) { next(err) }
})
router.put('/:id/columns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const columns = z.array(WorkflowColumnSchema).parse(req.body)
    const wf = await WorkflowModel.findOneAndUpdate({ _id: req.params.id, ownerId: req.userId! }, { $set: { columns } }, { new: true }).lean() as LeanDoc | null
    if (!wf) throw new NotFoundError('Workflow', req.params.id)
    res.json({ ...wf, _id: String(wf._id) })
  } catch (err) { next(err) }
})
export default router
