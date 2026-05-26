import mongoose, { Schema } from 'mongoose'

// Stores FCM tokens per device so the server can push notifications
const DeviceSchema = new Schema({
  fcmToken:  { type: String, required: true, unique: true },
  platform:  { type: String, default: 'android' },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true })

DeviceSchema.index({ fcmToken: 1 })

export default mongoose.models.Device || mongoose.model('Device', DeviceSchema)
