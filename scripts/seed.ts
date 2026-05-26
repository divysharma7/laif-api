/**
 * Run once to create the initial admin user.
 * Usage: npm run seed
 */
import mongoose from 'mongoose'
import { hash } from 'bcryptjs'
import { randomBytes } from 'crypto'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI not set. Check .env.local')
  process.exit(1)
}

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true })

const User = mongoose.models?.User ?? mongoose.model('User', UserSchema)

const TARGET_USERNAME = 'first username here'

async function seed() {
  await mongoose.connect(MONGODB_URI!)
  console.log('✅  Connected to MongoDB')

  const existing = await User.findOne({ username: TARGET_USERNAME })
  if (existing) {
    console.log(`ℹ️   User "${TARGET_USERNAME}" already exists — skipping.`)
    await mongoose.disconnect()
    return
  }

  // Generate a secure random password: 16 chars (alpha + digits)
  const rawPassword = "your password here"
  const passwordHash = await hash(rawPassword, 12)

  await User.create({ username: TARGET_USERNAME, passwordHash })

  console.log('\n✅  Seed complete!\n')
  console.log('┌─────────────────────────────────────┐')
  console.log(`│  Username : ${TARGET_USERNAME.padEnd(24)} │`)
  console.log(`│  Password : ${rawPassword.padEnd(24)} │`)
  console.log('└─────────────────────────────────────┘')
  console.log('\n⚠️  Save this password — it will NOT be shown again.\n')

  await mongoose.disconnect()
}

seed().catch(err => {
  console.error('❌  Seed failed:', err)
  process.exit(1)
})
