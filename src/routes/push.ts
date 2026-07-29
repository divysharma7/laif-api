import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { PushSubscribeSchema, parseBody } from '../lib/validation.js'
import { ValidationError } from '../lib/errors.js'

const router = Router()

router.post('/subscribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(PushSubscribeSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const { endpoint, keys } = parsed.data.subscription
    const prisma = getPrisma()
    const existing = await prisma.webPushSubscription.findUnique({
      where: { endpoint },
      select: { userId: true },
    })
    if (existing && existing.userId !== req.userId!) {
      res.status(409).json({ error: 'Subscription belongs to another user' })
      return
    }
    await prisma.webPushSubscription.upsert({
      where: { endpoint },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: parsed.data.userAgent ?? '',
      },
      create: {
        userId: req.userId!,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: parsed.data.userAgent ?? '',
      },
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

router.delete('/subscribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const endpoint = req.body?.endpoint
    if (typeof endpoint === 'string' && endpoint) {
      await getPrisma().webPushSubscription.deleteMany({
        where: { endpoint, userId: req.userId! },
      })
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
