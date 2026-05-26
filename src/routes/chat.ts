import { Router, type Request, type Response, type NextFunction } from 'express'
import ChatSessionModel from '../models/ChatSession.js'
import { CreateChatSessionSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try { const docs = await ChatSessionModel.find({ userId: req.userId! }).sort({ updatedAt: -1 }).select('title createdAt updatedAt').lean() as LeanDoc[]; res.json(docs.map(d => ({ ...d, _id: String(d._id) }))) } catch (err) { next(err) }
})
router.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try { const p = parseBody(CreateChatSessionSchema, req.body); if (!p.success) throw new ValidationError(p.error); const d = await ChatSessionModel.create({ ...(p.data as any), userId: req.userId! }); res.status(201).json({ ...d.toObject(), _id: String(d._id) }) } catch (err) { next(err) }
})
router.get('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { const d = await ChatSessionModel.findOne({ _id: req.params.id, userId: req.userId! }).lean() as LeanDoc | null; if (!d) throw new NotFoundError('ChatSession', req.params.id); res.json({ ...d, _id: String(d._id) }) } catch (err) { next(err) }
})
router.put('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { const d = await ChatSessionModel.findOneAndUpdate({ _id: req.params.id, userId: req.userId! }, { $set: req.body }, { new: true }).lean() as LeanDoc | null; if (!d) throw new NotFoundError('ChatSession', req.params.id); res.json({ ...d, _id: String(d._id) }) } catch (err) { next(err) }
})
router.delete('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try { await ChatSessionModel.findOneAndDelete({ _id: req.params.id, userId: req.userId! }); res.json({ success: true }) } catch (err) { next(err) }
})
// POST /chat — streaming AI chat (simplified — full agent loop can be added later)
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, sessionId } = req.body
    if (!message) { res.status(400).json({ error: 'Message required' }); return }
    // For now, echo back — the full agentic chat with OpenRouter can be ported separately
    res.json({ reply: 'Chat API connected. AI integration pending.', sessionId })
  } catch (err) { next(err) }
})
export default router
