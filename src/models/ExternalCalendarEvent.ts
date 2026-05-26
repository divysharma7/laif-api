import mongoose, { Schema } from 'mongoose'

const ExternalCalendarEventSchema = new Schema({
  userId: { type: String, required: true },
  source: { type: String, enum: ['google'], default: 'google' },
  externalId: { type: String, required: true },
  title: { type: String, default: '' },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  allDay: { type: Boolean, default: false },
  lastSyncedAt: { type: Date, default: Date.now },
  calendarId: { type: String, default: 'primary' },
}, { timestamps: true })

ExternalCalendarEventSchema.index({ userId: 1, start: 1, end: 1 })

export default mongoose.models.ExternalCalendarEvent || mongoose.model('ExternalCalendarEvent', ExternalCalendarEventSchema)
