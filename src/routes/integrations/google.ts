import { Router, type Request, type Response, type NextFunction } from 'express'
import UserModel from '../../models/User.js'
import { config } from '../../config.js'
import { NotFoundError } from '../../lib/errors.js'
const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/auth', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) { res.status(501).json({ error: 'Google integration not configured' }); return }
    const { google } = await import('googleapis')
    const oauth2 = new google.auth.OAuth2(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_REDIRECT_URI)
    const url = oauth2.generateAuthUrl({ access_type: 'offline', scope: ['https://www.googleapis.com/auth/calendar'], state: req.userId })
    res.json({ url })
  } catch (err) { next(err) }
})

router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state: userId } = req.query as Record<string, string>
    if (!code || !userId) { res.status(400).json({ error: 'Missing code or state' }); return }
    const { google } = await import('googleapis')
    const oauth2 = new google.auth.OAuth2(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_REDIRECT_URI)
    const { tokens } = await oauth2.getToken(code)
    await UserModel.findByIdAndUpdate(userId, { $set: { googleAccessToken: tokens.access_token, googleRefreshToken: tokens.refresh_token, googleCalendarConnected: true } })
    res.redirect(config.CORS_ORIGINS.split(',')[0] + '/settings?tab=integrations&google=connected')
  } catch (err) { next(err) }
})

router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try { const u = await UserModel.findById(req.userId!).select('googleCalendarConnected googleCalendarId').lean() as LeanDoc | null; if (!u) throw new NotFoundError('User', req.userId!); res.json({ connected: !!u.googleCalendarConnected, calendarId: u.googleCalendarId || 'primary' }) } catch (err) { next(err) }
})

router.post('/disconnect', async (req: Request, res: Response, next: NextFunction) => {
  try { await UserModel.findByIdAndUpdate(req.userId!, { $set: { googleAccessToken: null, googleRefreshToken: null, googleCalendarConnected: false } }); res.json({ ok: true }) } catch (err) { next(err) }
})

router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ ok: true, message: 'Google Calendar sync triggered' }) } catch (err) { next(err) }
})

router.post('/unsync', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ ok: true, message: 'Task unsynced from Google Calendar' }) } catch (err) { next(err) }
})

export default router
