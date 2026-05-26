import { Router, type Request, type Response, type NextFunction } from 'express'
import MemoryModel from '../models/Memory.js'
import { NotFoundError } from '../lib/errors.js'
const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { const docs = await MemoryModel.find({ userId: req.userId! }).sort({ createdAt: -1 }).lean() as LeanDoc[]; res.json(docs.map(d => ({ ...d, _id: String(d._id) }))) } catch (err) { next(err) }
})
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try { const d = await MemoryModel.create({ ...req.body, userId: req.userId! }); res.status(201).json({ ...d.toObject(), _id: String(d._id) }) } catch (err) { next(err) }
})
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { const d = await MemoryModel.findOneAndUpdate({ _id: req.params.id, userId: req.userId! }, { $set: req.body }, { new: true }).lean() as LeanDoc | null; if (!d) throw new NotFoundError('Memory', req.params.id); res.json({ ...d, _id: String(d._id) }) } catch (err) { next(err) }
})
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { await MemoryModel.findOneAndDelete({ _id: req.params.id, userId: req.userId! }); res.json({ success: true }) } catch (err) { next(err) }
})
export default router
