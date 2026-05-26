import { Router, type Request, type Response } from 'express'
const router = Router()
router.post('/', (_req: Request, res: Response) => { res.json({ error: 'Alexa integration disabled pending security audit' }) })
export default router
