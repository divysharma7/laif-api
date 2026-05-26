import { Router, type Request, type Response, type NextFunction } from 'express'
import ListModel from '../models/List.js'
import { CreateListSchema, UpdateListSchema, ListBlocksSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'

const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lists = await ListModel.find({ ownerId: req.userId!, deletedAt: null }).sort({ createdAt: -1 }).lean() as LeanDoc[]
    res.json(lists.map(l => ({ ...l, _id: String(l._id) })))
  } catch (err) { next(err) }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateListSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const list = await ListModel.create({ ...(parsed.data as any), ownerId: req.userId! })
    const plain = list.toObject() as LeanDoc
    res.status(201).json({ ...plain, _id: String(plain._id) })
  } catch (err) { next(err) }
})

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await ListModel.findOne({ _id: req.params.id, ownerId: req.userId!, deletedAt: null }).lean() as LeanDoc | null
    if (!list) throw new NotFoundError('List', req.params.id)
    res.json({ ...list, _id: String(list._id) })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateListSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const list = await ListModel.findOneAndUpdate({ _id: req.params.id, ownerId: req.userId! }, { $set: parsed.data }, { new: true }).lean() as LeanDoc | null
    if (!list) throw new NotFoundError('List', req.params.id)
    res.json({ ...list, _id: String(list._id) })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await ListModel.findOne({ _id: req.params.id, ownerId: req.userId! }).lean() as LeanDoc | null
    if (!list) throw new NotFoundError('List', req.params.id)
    if (list.isInbox) { res.status(400).json({ error: 'Cannot delete Inbox' }); return }
    await ListModel.findOneAndUpdate({ _id: req.params.id }, { $set: { deletedAt: new Date() } })
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.patch('/:id/blocks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(ListBlocksSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const list = await ListModel.findOneAndUpdate({ _id: req.params.id, ownerId: req.userId! }, { $set: { blocks: parsed.data.blocks } }, { new: true }).lean() as LeanDoc | null
    if (!list) throw new NotFoundError('List', req.params.id)
    res.json({ ...list, _id: String(list._id) })
  } catch (err) { next(err) }
})

export default router
