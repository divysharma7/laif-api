import { Router, type Request, type Response, type NextFunction } from 'express'
import PomodoroSessionModel from '../models/PomodoroSession.js'
import { CreatePomodoroSchema, UpdatePomodoroSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const since = new Date(); since.setDate(since.getDate() - 7)
    const docs = await PomodoroSessionModel.find({ userId: req.userId!, startedAt: { $gte: since } }).sort({ startedAt: -1 }).lean() as LeanDoc[]
    res.json(docs.map(d => ({ ...d, _id: String(d._id) })))
  } catch (err) { next(err) }
})
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(CreatePomodoroSchema, req.body); if (!p.success) throw new ValidationError(p.error); const d = await PomodoroSessionModel.create({ ...(p.data as any), userId: req.userId! }); res.status(201).json({ ...d.toObject(), _id: String(d._id) }) } catch (err) { next(err) }
})
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(UpdatePomodoroSchema, req.body); if (!p.success) throw new ValidationError(p.error); const d = await PomodoroSessionModel.findOneAndUpdate({ _id: req.params.id, userId: req.userId! }, { $set: p.data }, { new: true }).lean() as LeanDoc | null; if (!d) throw new NotFoundError('PomodoroSession', req.params.id); res.json({ ...d, _id: String(d._id) }) } catch (err) { next(err) }
})
export default router
