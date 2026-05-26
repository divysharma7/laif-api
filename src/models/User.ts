import mongoose, { Schema } from 'mongoose'

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, default: '' },
  passwordHash: { type: String, required: true },
  // Google Calendar integration
  googleAccessToken: { type: String, default: null },
  googleRefreshToken: { type: String, default: null },
  googleCalendarId: { type: String, default: 'primary' },
  googleCalendarConnected: { type: Boolean, default: false },
  // MCP Server integration
  mcpEnabled: { type: Boolean, default: false },
  mcpApiKey: { type: String, default: null },
  // Timezone & push devices
  timezone: { type: String, default: 'UTC' },
  pushDevices: [{
    type: { type: String, enum: ['web', 'ios', 'android'] },
    token: String,
    deviceName: String,
    addedAt: { type: Date, default: Date.now },
    lastSeenAt: Date,
    isActive: { type: Boolean, default: true },
  }],
  // Habit settings
  habitSettings: {
    checkinNudgeTime: { type: String, default: '21:00' },
    quietHoursStart: { type: String, default: '22:00' },
    quietHoursEnd: { type: String, default: '07:00' },
    streakFreezeEnabled: { type: Boolean, default: true },
    celebrationEnabled: { type: Boolean, default: true },
  },
  // Focus preferences
  focusPreferences: {
    defaultWorkMin: { type: Number, default: 25 },
    defaultShortBreakMin: { type: Number, default: 5 },
    defaultLongBreakMin: { type: Number, default: 15 },
    longBreakEveryNSessions: { type: Number, default: 4 },
    theme: { type: String, enum: ['aurora', 'minimal', 'liquid'], default: 'aurora' },
    soundOnComplete: { type: Boolean, default: true },
    showInSidebar: { type: Boolean, default: true },
    keyboardShortcutsEnabled: { type: Boolean, default: true },
  },
  // Calendar preferences
  calendarPreferences: {
    defaultView: { type: String, enum: ['day', '3day', 'week', 'multiweek', 'month', 'year', 'agenda'], default: 'week' },
    weekStartsOn: { type: Number, enum: [0, 1, 6], default: 1 },
    hiddenHoursStart: { type: Number, default: 21 },
    hiddenHoursEnd: { type: Number, default: 7 },
    dailyCapacityHours: { type: Number, default: 8 },
    colorCodingMode: { type: String, enum: ['list', 'priority', 'label'], default: 'list' },
    showHabitsOnCalendar: { type: Boolean, default: false },
    showFocusSessionsOnCalendar: { type: Boolean, default: false },
    showGoogleEventsOnCalendar: { type: Boolean, default: true },
    timeFormat: { type: String, enum: ['12h', '24h'], default: '12h' },
    showCurrentTimeIndicator: { type: Boolean, default: true },
  },
}, { timestamps: true })

export default mongoose.models.User || mongoose.model('User', UserSchema)
