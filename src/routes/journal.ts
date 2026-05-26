import { Router, type Request, type Response, type NextFunction } from 'express'
import JournalEntryModel from '../models/JournalEntry.js'
import { JournalSchema, parseBody } from '../lib/validation.js'
import { ValidationError } from '../lib/errors.js'
const router = Router()

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date } = req.query as Record<string, string>
    if (date) {
      const entry = await JournalEntryModel.findOne({ date }).lean()
      res.json(entry || { date, content: '' })
    } else {
      const entries = await JournalEntryModel.find().sort({ date: -1 }).select('date updatedAt').lean()
      res.json(entries)
    }
  } catch (err) { next(err) }
})
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const p = parseBody(JournalSchema, req.body); if (!p.success) throw new ValidationError(p.error)
    const entry = await JournalEntryModel.findOneAndUpdate({ date: p.data.date }, { $set: { content: p.data.content } }, { new: true, upsert: true }).lean()
    res.json(entry)
  } catch (err) { next(err) }
})
export default router
