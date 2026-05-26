import { Router, type Request, type Response, type NextFunction } from 'express'
import DeviceModel from '../models/Device.js'
const router = Router()

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fcmToken, platform } = req.body
    if (!fcmToken) { res.status(400).json({ error: 'fcmToken is required' }); return }
    await DeviceModel.findOneAndUpdate({ fcmToken }, { $set: { fcmToken, platform: platform || 'android', updatedAt: new Date() } }, { upsert: true })
    res.json({ ok: true })
  } catch (err) { next(err) }
})
export default router
