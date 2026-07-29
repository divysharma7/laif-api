import { createApp } from './app.js'
import { disconnectPrisma, getPrisma } from './lib/prisma.js'
import { config } from './config.js'
import { logger } from './lib/logger.js'
import { startGoogleCalendarSyncScheduler } from './services/googleCalendarSyncScheduler.js'

async function main() {
  await getPrisma().$connect()
  const app = createApp()
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'LAIF API server started')
  })
  const googleSyncTimer = startGoogleCalendarSyncScheduler()

  const shutdown = async () => {
    if (googleSyncTimer) clearInterval(googleSyncTimer)
    server.close()
    await disconnectPrisma()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

main().catch((err) => {
  logger.fatal(err, 'Failed to start server')
  process.exit(1)
})
