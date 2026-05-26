import { Router, type Request, type Response, type NextFunction } from 'express'
import EventModel from '../models/Event.js'
import { CreateEventSchema, UpdateEventSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'

const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const events = await EventModel.find({ userId: req.userId! }).sort({ startDate: 1 }).lean() as LeanDoc[]
    res.json(events.map(e => ({ ...e, _id: String(e._id) })))
  } catch (err) { next(err) }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateEventSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const event = await EventModel.create({ ...(parsed.data as any), userId: req.userId! })
    const plain = event.toObject() as LeanDoc
    res.status(201).json({ ...plain, _id: String(plain._id) })
  } catch (err) { next(err) }
})

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateEventSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const event = await EventModel.findOneAndUpdate({ _id: req.params.id, userId: req.userId! }, { $set: parsed.data }, { new: true }).lean() as LeanDoc | null
    if (!event) throw new NotFoundError('Event', req.params.id)
    res.json({ ...event, _id: String(event._id) })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await EventModel.findOneAndDelete({ _id: req.params.id, userId: req.userId! })
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.post('/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body
    if (!text) { res.status(400).json({ error: 'Comment text required' }); return }
    const event = await EventModel.findOneAndUpdate({ _id: req.params.id, userId: req.userId! }, { $push: { comments: { text, createdAt: new Date() } } }, { new: true }).lean() as LeanDoc | null
    if (!event) throw new NotFoundError('Event', req.params.id)
    res.json({ ...event, _id: String(event._id) })
  } catch (err) { next(err) }
})

export default router
