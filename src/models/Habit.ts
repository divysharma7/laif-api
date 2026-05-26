import mongoose, { Schema } from 'mongoose'

const HabitSchema = new Schema({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  description: String,
  frequency: {
    type: String,
    enum: ['daily', 'weekdays', 'weekly', 'custom'],
    default: 'daily',
  },
  customDays: [{ type: Number, min: 0, max: 6 }],
  color: { type: String, default: '#6366f1' },
  icon: { type: String, default: 'Circle' },
  completions: [{ type: String }], // YYYY-MM-DD strings
  currentStreak: { type: Number, default: 0 },
  bestStreak: { type: Number, default: 0 },
  archived: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
}, { timestamps: true })

HabitSchema.index({ archived: 1, order: 1 })

export default mongoose.models.Habit || mongoose.model('Habit', HabitSchema)
