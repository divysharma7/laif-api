import mongoose, { Schema } from 'mongoose'

const NotificationScheduleSchema = new Schema({
  userId: { type: String, required: true },
  type: {
    type: String,
    enum: ['habit_reminder', 'checkin_nudge', 'streak_milestone'],
    required: true,
  },
  scheduledFor: { type: Date, required: true },
  payload: {
    title: String,
    body: String,
    deepLink: String,
    habitId: String,
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'skipped', 'failed'],
    default: 'pending',
  },
  skippedReason: String,
  sentAt: Date,
}, { timestamps: true })

NotificationScheduleSchema.index({ userId: 1, status: 1, scheduledFor: 1 })

export default mongoose.models.NotificationSchedule ||
  mongoose.model('NotificationSchedule', NotificationScheduleSchema)
