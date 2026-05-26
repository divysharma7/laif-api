import { createApp } from './app.js'
import { connectDB } from './lib/mongodb.js'
import { config } from './config.js'
import { logger } from './lib/logger.js'

async function main() {
  await connectDB()
  const app = createApp()
  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'LAIF API server started')
  })
}

main().catch((err) => {
  logger.fatal(err, 'Failed to start server')
  process.exit(1)
})
