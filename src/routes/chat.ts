import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { CreateChatSessionSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'

const router = Router()

function serializeSession<T extends { id: string }>(session: T) {
  const { id, ...rest } = session
  return { ...rest, _id: id }
}

router.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessions = await getPrisma().chatSession.findMany({
      where: { userId: req.userId! },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    })
    res.json(sessions.map(serializeSession))
  } catch (err) {
    next(err)
  }
})

router.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateChatSessionSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const session = await getPrisma().chatSession.create({
      data: { userId: req.userId!, title: parsed.data.title ?? 'New chat' },
    })
    res.status(201).json(serializeSession({ ...session, messages: [] }))
  } catch (err) {
    next(err)
  }
})

router.get('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await getPrisma().chatSession.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      include: { messages: { orderBy: { position: 'asc' } } },
    })
    if (!session) throw new NotFoundError('ChatSession', req.params.id)
    res.json(serializeSession({
      ...session,
      messages: session.messages.map(({ id: _id, sessionId, position, ...message }) => message),
    }))
  } catch (err) {
    next(err)
  }
})

router.put('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma()
    const existing = await prisma.chatSession.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      select: { id: true },
    })
    if (!existing) throw new NotFoundError('ChatSession', req.params.id)

    const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 200) : undefined
    const messages = Array.isArray(req.body?.messages)
      ? req.body.messages
        .filter((message: unknown): message is { role: 'user' | 'assistant'; content: string; timestamp?: string } => {
          if (!message || typeof message !== 'object') return false
          const value = message as Record<string, unknown>
          return (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string'
        })
        .map((message: { role: 'user' | 'assistant'; content: string; timestamp?: string }, position: number) => ({
          position,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
        }))
      : undefined

    const session = await prisma.$transaction(async (tx) => {
      if (messages) {
        await tx.chatSessionMessage.deleteMany({ where: { sessionId: existing.id } })
        if (messages.length) {
          await tx.chatSessionMessage.createMany({
            data: messages.map((message: {
              position: number
              role: 'user' | 'assistant'
              content: string
              timestamp: Date
            }) => ({ ...message, sessionId: existing.id })),
          })
        }
      }
      return tx.chatSession.update({
        where: { id: existing.id },
        data: { ...(title !== undefined ? { title } : {}), updatedAt: new Date() },
        include: { messages: { orderBy: { position: 'asc' } } },
      })
    })

    res.json(serializeSession({
      ...session,
      messages: session.messages.map(({ id: _id, sessionId, position, ...message }) => message),
    }))
  } catch (err) {
    next(err)
  }
})

router.delete('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getPrisma().chatSession.deleteMany({
      where: { id: req.params.id, userId: req.userId! },
    })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, sessionId } = req.body
    if (!message) {
      res.status(400).json({ error: 'Message required' })
      return
    }
    res.json({ reply: 'Chat API connected. AI integration pending.', sessionId })
  } catch (err) {
    next(err)
  }
})

export default router
