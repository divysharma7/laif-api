import { Router, type Request, type Response, type NextFunction } from 'express'
import ContactModel from '../models/Contact.js'
import { CreateContactSchema, UpdateContactSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { const docs = await ContactModel.find().sort({ name: 1 }).lean() as LeanDoc[]; res.json(docs.map(d => ({ ...d, _id: String(d._id) }))) } catch (err) { next(err) }
})
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(CreateContactSchema, req.body); if (!p.success) throw new ValidationError(p.error); const d = await ContactModel.create(p.data); res.status(201).json({ ...d.toObject(), _id: String(d._id) }) } catch (err) { next(err) }
})
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(UpdateContactSchema, req.body); if (!p.success) throw new ValidationError(p.error); const d = await ContactModel.findByIdAndUpdate(req.params.id, { $set: p.data }, { new: true }).lean() as LeanDoc | null; if (!d) throw new NotFoundError('Contact', req.params.id); res.json({ ...d, _id: String(d._id) }) } catch (err) { next(err) }
})
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { await ContactModel.findByIdAndDelete(req.params.id); res.json({ success: true }) } catch (err) { next(err) }
})
export default router
