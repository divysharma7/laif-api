import mongoose from 'mongoose'
import { config } from '../config.js'
import { logger } from './logger.js'

let connected = false

export async function connectDB(): Promise<typeof mongoose> {
  if (connected) return mongoose
  const conn = await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  })
  connected = true
  logger.info('MongoDB connected')
  return conn
}
