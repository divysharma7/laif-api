import { Router, type Request, type Response, type NextFunction } from 'express'
import NotificationScheduleModel from '../models/NotificationSchedule.js'
const router = Router()

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docs = await NotificationScheduleModel.find({ userId: req.userId!, status: 'pending' }).sort({ scheduledFor: 1 }).limit(50).lean()
    res.json(docs.map((d: any) => ({ ...d, _id: String(d._id) })))
  } catch (err) { next(err) }
})
export default router
