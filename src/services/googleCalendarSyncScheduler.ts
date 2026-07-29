import { config } from '../config.js'
import { logger } from '../lib/logger.js'
import { syncDueGoogleAccounts } from './googleCalendarSync.js'

export function startGoogleCalendarSyncScheduler(): NodeJS.Timeout | null {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_TOKEN_ENCRYPTION_KEY) {
    logger.info('Google Calendar sync scheduler disabled because integration is not configured')
    return null
  }

  const run = async () => {
    try {
      const accountsQueued = await syncDueGoogleAccounts()
      if (accountsQueued > 0) {
        logger.info({ accountsQueued }, 'Google Calendar sync cycle completed')
      }
    } catch (error) {
      logger.error({ error }, 'Google Calendar sync cycle failed')
    }
  }

  void run()
  const timer = setInterval(
    run,
    config.GOOGLE_SYNC_INTERVAL_MINUTES * 60 * 1000,
  )
  timer.unref()
  return timer
}
