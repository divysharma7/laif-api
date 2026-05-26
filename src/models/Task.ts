import mongoose, { Schema } from 'mongoose'

const TaskSchema = new Schema({
  userId: { type: String, index: true },
  workflowId: { type: String, index: true, default: null },
  title: { type: String, required: true },
  description: String,
  notes: { type: mongoose.Schema.Types.Mixed, default: null },
  dueDate: Date,
  priority: { type: String, enum: ['low', 'medium', 'high', null], default: 'medium' },
  status: { type: String, enum: ['backlog', 'todo', 'in-progress', 'done', 'dropped'], default: 'backlog' },
  color: { type: String, default: '#34d399' },
  comments: [{ text: { type: String, required: true }, createdAt: { type: Date, default: Date.now }, authorName: String, authorAvatar: String }],
  reminders: [{
    id: { type: String, required: true },
    type: { type: String, enum: ['before-start', 'on-day-at', 'absolute'], default: 'before-start' },
    offsetMinutes: { type: Number, default: 15 },
    timeOfDay: { type: String, default: null },
    absoluteTime: { type: Date, default: null },
    sent: { type: Boolean, default: false },
  }],
  tags: [{ type: String }],
  repeat: { type: String, enum: ['daily', 'weekdays', 'weekly', 'monthly', 'yearly', null], default: null },
  completedAt: { type: Date, default: null },
  listId: { type: String, default: null },
  // Calendar & scheduling fields
  scheduledStart: { type: Date, default: null },
  scheduledEnd: { type: Date, default: null },
  estimatedEffort: { type: Number, default: null },
  actualEffort: { type: Number, default: 0 },
  googleEventId: { type: String, default: null },
  calendarSynced: { type: Boolean, default: false },
  // Nested task fields
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
  depth: { type: Number, default: 0 },
  path: { type: String, default: '/' },
  order: { type: Number, default: 0 },
  // Habit fields
  isHabit: { type: Boolean, default: false },
  habitGoalType: { type: String, enum: ['binary', 'count', null], default: null },
  habitTarget: { type: Number, default: null },
  habitUnit: { type: String, default: null },
  habitFrequency: { type: mongoose.Schema.Types.Mixed, default: null },
  // habitFrequency shapes:
  // { type: 'daily', daysOfWeek: [1,2,3,4,5] }
  // | { type: 'weekly', timesPerWeek: 3 }
  // | { type: 'interval', everyDays: 3 }
  streakCurrent: { type: Number, default: 0 },
  streakBest: { type: Number, default: 0 },
  streakLastUpdated: { type: Date, default: null },
  completions: [{
    date: String,       // 'YYYY-MM-DD'
    status: { type: String, enum: ['achieved', 'unachieved', 'skipped', 'frozen'] },
    value: Number,      // for count habits
    reason: String,     // for unachieved
    loggedAt: Date,
  }],
  habitReminderTime: { type: String, default: null }, // HH:MM format
  habitIcon: { type: String, default: null },
  habitColor: { type: String, default: null },
  // Kanban fields
  kanbanOrder: { type: Number, default: 0 },
  sectionId: { type: String, default: null },
  // Activity log
  activities: [{
    action: { type: String, required: true },
    detail: { type: String },
    timestamp: { type: Date, default: Date.now },
  }],
}, { timestamps: true })

TaskSchema.index({ parentId: 1, order: 1 })
TaskSchema.index({ sectionId: 1 })
TaskSchema.index({ scheduledStart: 1 })

export default mongoose.models.Task || mongoose.model('Task', TaskSchema)
