import mongoose, { Schema } from 'mongoose'

const EventSchema = new Schema({
  userId: { type: String, required: true, index: true },
  type: { type: String, default: 'event' },
  title: { type: String, required: true },
  description: String,
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  allDay: { type: Boolean, default: false },
  location: String,
  color: { type: String, default: '#5b8ded' },
  posthookId: { type: String, default: null },
  comments: [{ text: { type: String, required: true }, createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true })

EventSchema.index({ userId: 1, startDate: 1 })

export default mongoose.models.Event || mongoose.model('Event', EventSchema)
