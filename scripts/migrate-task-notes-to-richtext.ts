/**
 * Migration: Convert plain-text `description` fields into TipTap-compatible
 * rich-text JSON stored in the new `notes` field.
 *
 * This is non-destructive and idempotent:
 *  - Only touches documents where `description` is a non-empty string AND
 *    `notes` is null or missing.
 *  - Does NOT modify or remove the `description` field.
 *  - Running this script multiple times is safe — already-migrated documents
 *    are skipped because their `notes` field is no longer null/missing.
 *
 * Multi-line descriptions are split by `\n` into separate paragraph nodes.
 *
 * Usage:
 *   npx tsx scripts/migrate-task-notes-to-richtext.ts
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

/**
 * Converts a plain-text string into a TipTap ProseMirror JSON document.
 * Each line becomes its own paragraph node.
 */
function textToTipTapDoc(text: string) {
  const lines = text.split('\n')
  const content = lines.map((line) => {
    if (line.length === 0) {
      // Empty line becomes an empty paragraph
      return { type: 'paragraph' as const }
    }
    return {
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text: line }],
    }
  })

  return {
    type: 'doc',
    content,
  }
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

  // Find tasks with a non-empty description and no notes yet
  const cursor = collection.find({
    description: { $exists: true, $ne: '', $type: 'string' },
    $or: [{ notes: { $exists: false } }, { notes: null }],
  })

  let migratedCount = 0

  for await (const doc of cursor) {
    const description = doc.description as string
    const notesDoc = textToTipTapDoc(description)

    await collection.updateOne(
      { _id: doc._id },
      { $set: { notes: notesDoc } }
    )
    migratedCount++
  }

  console.log(`Migration complete. Migrated ${migratedCount} documents.`)

  await mongoose.disconnect()
  console.log('Disconnected from MongoDB.')
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
