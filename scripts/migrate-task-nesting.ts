/**
 * Migration: Add nesting fields to existing tasks.
 *
 * This is non-destructive — it only sets fields that don't already exist
 * on each document using $set with a filter that checks for missing fields.
 *
 * Usage:
 *   npx tsx scripts/migrate-task-nesting.ts
 */

import mongoose from 'mongoose'
import * as dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local (Next.js convention)
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI env variable is not defined.')
  console.error('Make sure .env.local or .env contains MONGODB_URI.')
  process.exit(1)
}

async function migrate() {
  console.log('Connecting to MongoDB...')
  await mongoose.connect(MONGODB_URI!)

  const db = mongoose.connection.db
  if (!db) {
    console.error('Error: Could not get database reference.')
    process.exit(1)
  }

  const collection = db.collection('tasks')

  // Update tasks that are missing any of the nesting fields.
  // Only sets fields that don't exist yet (non-destructive).
  const result = await collection.updateMany(
    {
      $or: [
        { parentId: { $exists: false } },
        { depth: { $exists: false } },
        { path: { $exists: false } },
        { order: { $exists: false } },
      ],
    },
    {
      $set: {
        parentId: null,
        depth: 0,
        path: '/',
        order: 0,
      },
    }
  )

  console.log(`Migration complete. Updated ${result.modifiedCount} documents.`)
  console.log(`Matched ${result.matchedCount} documents total.`)

  await mongoose.disconnect()
  console.log('Disconnected from MongoDB.')
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
