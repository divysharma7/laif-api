import { Router, type Request, type Response, type NextFunction } from 'express'
import ListGroupModel from '../models/ListGroup.js'
import ListModel from '../models/List.js'
import { CreateListGroupSchema, UpdateListGroupSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { const docs = await ListGroupModel.find({ ownerId: req.userId! }).sort({ order: 1 }).lean() as LeanDoc[]; res.json(docs.map(d => ({ ...d, _id: String(d._id) }))) } catch (err) { next(err) }
})
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(CreateListGroupSchema, req.body); if (!p.success) throw new ValidationError(p.error); const count = await ListGroupModel.countDocuments({ ownerId: req.userId! }); const d = await ListGroupModel.create({ ...(p.data as any), ownerId: req.userId!, order: count }); res.status(201).json({ ...d.toObject(), _id: String(d._id) }) } catch (err) { next(err) }
})
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(UpdateListGroupSchema, req.body); if (!p.success) throw new ValidationError(p.error); const d = await ListGroupModel.findOneAndUpdate({ _id: req.params.id, ownerId: req.userId! }, { $set: p.data }, { new: true }).lean() as LeanDoc | null; if (!d) throw new NotFoundError('ListGroup', req.params.id); res.json({ ...d, _id: String(d._id) }) } catch (err) { next(err) }
})
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { await ListGroupModel.findOneAndDelete({ _id: req.params.id, ownerId: req.userId! }); await ListModel.updateMany({ groupId: req.params.id, ownerId: req.userId! }, { $set: { groupId: null } }); res.json({ success: true }) } catch (err) { next(err) }
})
export default router
