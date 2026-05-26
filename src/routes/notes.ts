import { Router, type Request, type Response, type NextFunction } from 'express'
import NoteModel from '../models/Note.js'
import { CreateNoteSchema, UpdateNoteSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { const docs = await NoteModel.find().sort({ updatedAt: -1 }).lean() as LeanDoc[]; res.json(docs.map(d => ({ ...d, _id: String(d._id) }))) } catch (err) { next(err) }
})
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(CreateNoteSchema, req.body); if (!p.success) throw new ValidationError(p.error); const d = await NoteModel.create(p.data); res.status(201).json({ ...d.toObject(), _id: String(d._id) }) } catch (err) { next(err) }
})
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(UpdateNoteSchema, req.body); if (!p.success) throw new ValidationError(p.error); const d = await NoteModel.findByIdAndUpdate(req.params.id, { $set: p.data }, { new: true }).lean() as LeanDoc | null; if (!d) throw new NotFoundError('Note', req.params.id); res.json({ ...d, _id: String(d._id) }) } catch (err) { next(err) }
})
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { await NoteModel.findByIdAndDelete(req.params.id); res.json({ success: true }) } catch (err) { next(err) }
})
export default router
