import mongoose, { Schema } from 'mongoose'

const FocusSessionSchema = new Schema({
  userId: { type: String, required: true },
  taskId: { type: String, default: null },
  taskTitleSnapshot: { type: String, default: null },
  plannedDurationMin: { type: Number, default: 25 },
  plannedBreakMin: { type: Number, default: 5 },
  startedAt: { type: Date, required: true },
  pausedAt: { type: Date, default: null },
  totalPausedMs: { type: Number, default: 0 },
  endedAt: { type: Date, default: null },
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled', 'extended'],
    default: 'active',
  },
  actualDurationMin: { type: Number, default: 0 },
  extendedByMin: { type: Number, default: 0 },
  endedReason: {
    type: String,
    enum: ['timer_ended', 'user_completed', 'user_cancelled', null],
    default: null,
  },
  postSessionNote: { type: String, default: null, maxlength: 200 },
}, { timestamps: true })

FocusSessionSchema.index({ userId: 1, status: 1, startedAt: -1 })

export default mongoose.models.FocusSession || mongoose.model('FocusSession', FocusSessionSchema)
