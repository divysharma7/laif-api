import { Router, type Request, type Response, type NextFunction } from 'express'
import KanbanSectionModel from '../models/KanbanSection.js'
import TaskModel from '../models/Task.js'
import { CreateKanbanSectionSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sections = await KanbanSectionModel.find({ userId: req.userId! }).sort({ order: 1 }).lean() as LeanDoc[]
    res.json(sections.map(s => ({ ...s, _id: String(s._id) })))
  } catch (err) { next(err) }
})
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateKanbanSectionSchema, req.body); if (!parsed.success) throw new ValidationError(parsed.error)
    const count = await KanbanSectionModel.countDocuments({ userId: req.userId! })
    const sec = await KanbanSectionModel.create({ ...(parsed.data as any), userId: req.userId!, order: count })
    res.status(201).json({ ...sec.toObject(), _id: String(sec._id) })
  } catch (err) { next(err) }
})
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sec = await KanbanSectionModel.findOneAndUpdate({ _id: req.params.id, userId: req.userId! }, { $set: req.body }, { new: true }).lean() as LeanDoc | null
    if (!sec) throw new NotFoundError('KanbanSection', req.params.id)
    res.json({ ...sec, _id: String(sec._id) })
  } catch (err) { next(err) }
})
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await KanbanSectionModel.findOneAndDelete({ _id: req.params.id, userId: req.userId! })
    await TaskModel.updateMany({ sectionId: req.params.id, userId: req.userId! }, { $set: { sectionId: null } })
    res.json({ success: true })
  } catch (err) { next(err) }
})
export default router
