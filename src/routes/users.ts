import { Router, type Request, type Response, type NextFunction } from 'express'
import UserModel from '../models/User.js'
import { FocusPreferencesSchema, parseBody } from '../lib/validation.js'
import { ValidationError, NotFoundError } from '../lib/errors.js'
const router = Router()
type LeanDoc = Record<string, unknown> & { _id: unknown }

router.get('/me/focus-preferences', async (req: Request, res: Response, next: NextFunction) => {
  try { const u = await UserModel.findById(req.userId!).select('focusPreferences').lean() as LeanDoc | null; if (!u) throw new NotFoundError('User', req.userId!); res.json(u.focusPreferences || {}) } catch (err) { next(err) }
})
router.patch('/me/focus-preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const p = parseBody(FocusPreferencesSchema, req.body); if (!p.success) throw new ValidationError(p.error)
    const updates: Record<string, unknown> = {}; for (const [k, v] of Object.entries(p.data as Record<string, unknown>)) { if (v !== undefined) updates[`focusPreferences.${k}`] = v }
    const u = await UserModel.findByIdAndUpdate(req.userId!, { $set: updates }, { new: true }).select('focusPreferences').lean() as LeanDoc | null
    if (!u) throw new NotFoundError('User', req.userId!); res.json(u.focusPreferences)
  } catch (err) { next(err) }
})
router.get('/me/calendar-preferences', async (req: Request, res: Response, next: NextFunction) => {
  try { const u = await UserModel.findById(req.userId!).select('calendarPreferences').lean() as LeanDoc | null; if (!u) throw new NotFoundError('User', req.userId!); res.json(u.calendarPreferences || {}) } catch (err) { next(err) }
})
router.patch('/me/calendar-preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates: Record<string, unknown> = {}; for (const [k, v] of Object.entries(req.body)) { if (v !== undefined) updates[`calendarPreferences.${k}`] = v }
    const u = await UserModel.findByIdAndUpdate(req.userId!, { $set: updates }, { new: true }).select('calendarPreferences').lean() as LeanDoc | null
    if (!u) throw new NotFoundError('User', req.userId!); res.json(u.calendarPreferences)
  } catch (err) { next(err) }
})
router.get('/me/mcp', async (req: Request, res: Response, next: NextFunction) => {
  try { const u = await UserModel.findById(req.userId!).select('mcpEnabled mcpApiKey').lean() as LeanDoc | null; if (!u) throw new NotFoundError('User', req.userId!); res.json({ mcpEnabled: u.mcpEnabled, mcpApiKey: u.mcpApiKey }) } catch (err) { next(err) }
})
router.patch('/me/mcp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mcpEnabled } = req.body; const $set: Record<string, unknown> = {}
    if (mcpEnabled !== undefined) { $set.mcpEnabled = mcpEnabled; if (mcpEnabled && !req.body.mcpApiKey) { const { v4 } = await import('uuid'); $set.mcpApiKey = v4() } }
    const u = await UserModel.findByIdAndUpdate(req.userId!, { $set }, { new: true }).select('mcpEnabled mcpApiKey').lean() as LeanDoc | null
    if (!u) throw new NotFoundError('User', req.userId!); res.json({ mcpEnabled: u.mcpEnabled, mcpApiKey: u.mcpApiKey })
  } catch (err) { next(err) }
})
export default router
