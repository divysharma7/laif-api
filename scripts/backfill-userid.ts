/**
 * Backfill userId on Event and Reminder documents that were created
 * before the userId field was added.
 *
 * Usage: npx tsx scripts/backfill-userid.ts
 * Custom user: npx tsx scripts/backfill-userid.ts <userId>
 */
import mongoose from 'mongoose'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Check .env.local')
  process.exit(1)
}

const TARGET_USER_ID = process.argv[2] || '6a0ace89bbece9a4ac3e81c9'

async function backfill() {
  await mongoose.connect(MONGODB_URI!)
  console.log('Connected to MongoDB\n')

  const db = mongoose.connection.db!

  const orphanedEvents = await db.collection('events').countDocuments({ userId: { $exists: false } })
  const orphanedReminders = await db.collection('reminders').countDocuments({ userId: { $exists: false } })

  console.log(`Orphaned events (no userId):    ${orphanedEvents}`)
  console.log(`Orphaned reminders (no userId): ${orphanedReminders}`)

  if (orphanedEvents === 0 && orphanedReminders === 0) {
    console.log('\nNo orphaned documents. Nothing to do.')
    await mongoose.disconnect()
    return
  }

  if (orphanedEvents > 0) {
    const result = await db.collection('events').updateMany(
      { userId: { $exists: false } },
      { $set: { userId: TARGET_USER_ID } },
    )
    console.log(`\nBackfilled ${result.modifiedCount} events with userId=${TARGET_USER_ID}`)
  }

  if (orphanedReminders > 0) {
    const result = await db.collection('reminders').updateMany(
      { userId: { $exists: false } },
      { $set: { userId: TARGET_USER_ID } },
    )
    console.log(`Backfilled ${result.modifiedCount} reminders with userId=${TARGET_USER_ID}`)
  }

  console.log('\nDone.')
  await mongoose.disconnect()
}

backfill().catch(err => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
