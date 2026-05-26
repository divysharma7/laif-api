import { Router, type Request, type Response, type NextFunction } from 'express'
import WebPushSubscriptionModel from '../models/WebPushSubscription.js'
import { PushSubscribeSchema, parseBody } from '../lib/validation.js'
import { ValidationError } from '../lib/errors.js'
const router = Router()

router.post('/subscribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const p = parseBody(PushSubscribeSchema, req.body); if (!p.success) throw new ValidationError(p.error)
    await WebPushSubscriptionModel.findOneAndUpdate({ endpoint: p.data.subscription.endpoint }, { $set: { ...(p.data as any).subscription, userAgent: p.data.userAgent } }, { upsert: true })
    res.json({ ok: true })
  } catch (err) { next(err) }
})
router.delete('/subscribe', async (req: Request, res: Response, next: NextFunction) => {
  try { const { endpoint } = req.body; if (endpoint) await WebPushSubscriptionModel.findOneAndDelete({ endpoint }); res.json({ ok: true }) } catch (err) { next(err) }
})
export default router
