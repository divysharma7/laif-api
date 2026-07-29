import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'

const router = Router()

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schedules = await getPrisma().notificationSchedule.findMany({
      where: { userId: req.userId!, status: 'pending' },
      orderBy: { scheduledFor: 'asc' },
      take: 50,
    })
    res.json(schedules.map(({ id, ...schedule }) => ({ ...schedule, _id: id })))
  } catch (err) {
    next(err)
  }
})

export default router
