import { Router, type Request, type Response, type NextFunction } from 'express'
import ReminderModel from '../models/Reminder.js'
import { CreateReminderSchema, UpdateReminderSchema, ReminderSnoozeSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { const docs = await ReminderModel.find({ userId: req.userId! }).sort({ reminderDate: 1 }).lean() as LeanDoc[]; res.json(docs.map(d => ({ ...d, _id: String(d._id) }))) } catch (err) { next(err) }
})
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(CreateReminderSchema, req.body); if (!p.success) throw new ValidationError(p.error); const d = await ReminderModel.create({ ...(p.data as any), userId: req.userId! }); res.status(201).json({ ...d.toObject(), _id: String(d._id) }) } catch (err) { next(err) }
})
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(UpdateReminderSchema, req.body); if (!p.success) throw new ValidationError(p.error); const d = await ReminderModel.findOneAndUpdate({ _id: req.params.id, userId: req.userId! }, { $set: p.data }, { new: true }).lean() as LeanDoc | null; if (!d) throw new NotFoundError('Reminder', req.params.id); res.json({ ...d, _id: String(d._id) }) } catch (err) { next(err) }
})
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { await ReminderModel.findOneAndDelete({ _id: req.params.id, userId: req.userId! }); res.json({ success: true }) } catch (err) { next(err) }
})
router.post('/:id/snooze', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(ReminderSnoozeSchema, req.body); if (!p.success) throw new ValidationError(p.error); const newDate = new Date(Date.now() + p.data.snoozeMinutes * 60000); const d = await ReminderModel.findOneAndUpdate({ _id: req.params.id, userId: req.userId! }, { $set: { reminderDate: newDate, notified: false } }, { new: true }).lean() as LeanDoc | null; if (!d) throw new NotFoundError('Reminder', req.params.id); res.json({ ...d, _id: String(d._id) }) } catch (err) { next(err) }
})
router.post('/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try { const { text } = req.body; if (!text) { res.status(400).json({ error: 'Comment text required' }); return }; const d = await ReminderModel.findOneAndUpdate({ _id: req.params.id, userId: req.userId! }, { $push: { comments: { text, createdAt: new Date() } } }, { new: true }).lean() as LeanDoc | null; if (!d) throw new NotFoundError('Reminder', req.params.id); res.json({ ...d, _id: String(d._id) }) } catch (err) { next(err) }
})
export default router
