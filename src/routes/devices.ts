import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'

const router = Router()

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fcmToken, platform } = req.body ?? {}
    if (typeof fcmToken !== 'string' || !fcmToken) {
      res.status(400).json({ error: 'fcmToken is required' })
      return
    }
    const prisma = getPrisma()
    const existing = await prisma.device.findUnique({
      where: { fcmToken },
      select: { userId: true },
    })
    if (existing && existing.userId !== req.userId!) {
      res.status(409).json({ error: 'Device token belongs to another user' })
      return
    }
    await prisma.device.upsert({
      where: { fcmToken },
      update: {
        platform: typeof platform === 'string' ? platform : 'android',
      },
      create: {
        userId: req.userId!,
        fcmToken,
        platform: typeof platform === 'string' ? platform : 'android',
      },
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
