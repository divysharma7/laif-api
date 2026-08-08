/**
 * POST /api/analytics — privacy-safe product milestone tracking.
 *
 * Accepts an event name and anonymous metadata.
 * Logs to the structured logger (never stored in the database).
 * Always returns 200 — analytics failure must never block a user action.
 *
 * Privacy rules enforced server-side:
 *  - Only known event names are accepted.
 *  - Metadata values are limited to booleans, numbers, and short strings.
 *  - Fields that might contain user content (title, body, note, etc.)
 *    are stripped before logging.
 */

import { Router, type Request, type Response } from 'express'
import { logger } from '../lib/logger.js'

const router = Router()

// ── Allowed events ─────────────────────────────────────────────

const ALLOWED_EVENTS = new Set([
  'onboarding_completed',
  'google_connected',
  'first_task_scheduled',
  'first_focus_session',
  'morning_plan_completed',
  'evening_shutdown_completed',
  'daily_loop_completed',
])

// ── Denied metadata keys ───────────────────────────────────────
// Fields that might inadvertently carry user content.

const DENIED_KEYS = new Set([
  'title',
  'body',
  'note',
  'notes',
  'description',
  'content',
  'text',
  'token',
  'tokens',
  'accessToken',
  'refreshToken',
  'email',
  'name',
  'username',
])

// ── Helpers ────────────────────────────────────────────────────

function sanitizeMetadata(
  raw: Record<string, unknown> | undefined,
): Record<string, boolean | number | string> {
  if (!raw || typeof raw !== 'object') return {}

  const sanitized: Record<string, boolean | number | string> = {}

  for (const [key, value] of Object.entries(raw)) {
    // Skip denied keys.
    if (DENIED_KEYS.has(key.toLowerCase())) continue

    // Only allow primitive values.
    if (typeof value === 'boolean' || typeof value === 'number') {
      sanitized[key] = value
    } else if (typeof value === 'string' && value.length <= 64) {
      sanitized[key] = value
    }
  }

  return sanitized
}

// ── Route ──────────────────────────────────────────────────────

router.post('/', (req: Request, res: Response) => {
  try {
    const { event, timestamp, metadata } = req.body ?? {}

    // Validate event name.
    if (typeof event !== 'string' || !ALLOWED_EVENTS.has(event)) {
      // Return 200 regardless — don't leak information about valid events.
      res.status(200).json({ ok: true })
      return
    }

    const safeMetadata = sanitizeMetadata(metadata)

    logger.info(
      {
        analytics: true,
        event,
        timestamp: typeof timestamp === 'string' ? timestamp : new Date().toISOString(),
        userId: req.userId ?? 'anonymous',
        ...safeMetadata,
      },
      `analytics:${event}`,
    )
  } catch {
    // Never fail — even malformed payloads get a 200.
  }

  res.status(200).json({ ok: true })
})

export default router
