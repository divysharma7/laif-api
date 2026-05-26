import mongoose, { Schema } from 'mongoose'

const PomodoroSessionSchema = new Schema({
  userId: { type: String, required: true, index: true },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
  taskTitle: { type: String, default: '' },
  type: { type: String, enum: ['focus', 'break'], required: true },
  duration: { type: Number, required: true },  // seconds
  startedAt: { type: Date, required: true },
  completedAt: { type: Date, default: null },  // null if interrupted
  completed: { type: Boolean, default: false },
}, { timestamps: true })

PomodoroSessionSchema.index({ startedAt: -1 })

export default mongoose.models.PomodoroSession || mongoose.model('PomodoroSession', PomodoroSessionSchema)
