import { connectDB } from '../lib/mongodb.js'
import NotificationSchedule from '../models/NotificationSchedule'

// ── Helpers ─────────────────────────────────────────────────────

/** Parse "HH:MM" string into { hours, minutes } */
function parseTime(hhmm: string): { hours: number; minutes: number } {
  const [h, m] = hhmm.split(':').map(Number)
  return { hours: h, minutes: m }
}

/** Get today at midnight in a given timezone */
function todayInTimezone(timezone: string): Date {
  const now = new Date()
  const str = now.toLocaleDateString('en-CA', { timeZone: timezone }) // YYYY-MM-DD
  return new Date(str + 'T00:00:00')
}

/** Build a Date for a given YYYY-MM-DD + HH:MM in a timezone */
function buildScheduledDate(
  dateStr: string,
  timeStr: string,
  timezone: string,
): Date {
  // Create a date string that represents the local time in the given timezone
  const { hours, minutes } = parseTime(timeStr)
  const base = new Date(dateStr + 'T00:00:00')
  base.setHours(hours, minutes, 0, 0)

  // Convert from the user's timezone to UTC by calculating offset
  const utcStr = base.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = base.toLocaleString('en-US', { timeZone: timezone })
  const diff = new Date(utcStr).getTime() - new Date(tzStr).getTime()
  return new Date(base.getTime() + diff)
}

/** Check if a given date falls on a day included in the habit frequency */
function isDateDue(
  date: Date,
  frequency: { type: string; daysOfWeek?: number[]; timesPerWeek?: number; everyDays?: number },
  startDate?: Date,
): boolean {
  if (!frequency) return true

  const dayOfWeek = date.getDay() // 0=Sun, 1=Mon, ...

  switch (frequency.type) {
    case 'daily': {
      // If daysOfWeek specified, check membership
      if (frequency.daysOfWeek && frequency.daysOfWeek.length > 0) {
        return frequency.daysOfWeek.includes(dayOfWeek)
      }
      return true // every day
    }
    case 'weekly': {
      // For weekly, we schedule reminders every day — the checkin logic
      // handles counting how many times per week
      return true
    }
    case 'interval': {
      if (!frequency.everyDays || !startDate) return true
      const diffMs = date.getTime() - startDate.getTime()
      const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000))
      return diffDays % frequency.everyDays === 0
    }
    default:
      return true
  }
}

// ── Core scheduling functions ───────────────────────────────────

/**
 * Creates 30 days of pending notification entries for a habit reminder.
 */
export async function scheduleHabitReminder(
  habitId: string,
  userId: string,
  reminderTime: string, // "HH:MM"
  habitFrequency: { type: string; daysOfWeek?: number[]; timesPerWeek?: number; everyDays?: number } | null,
  timezone: string = 'UTC',
): Promise<number> {
  await connectDB()

  // Remove any existing pending reminders for this habit
  await NotificationSchedule.deleteMany({
    userId,
    type: 'habit_reminder',
    'payload.habitId': habitId,
    status: 'pending',
  })

  const entries = []
  const today = todayInTimezone(timezone)

  for (let i = 0; i < 30; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0]

    // Skip days when the habit isn't due
    if (habitFrequency && !isDateDue(date, habitFrequency, today)) {
      continue
    }

    const scheduledFor = buildScheduledDate(dateStr, reminderTime, timezone)

    entries.push({
      userId,
      type: 'habit_reminder',
      scheduledFor,
      payload: {
        title: 'Habit Reminder',
        body: 'Time to check in on your habit!',
        deepLink: `/habits/${habitId}`,
        habitId,
      },
      status: 'pending',
    })
  }

  if (entries.length > 0) {
    await NotificationSchedule.insertMany(entries)
  }

  return entries.length
}

/**
 * Creates daily nudge entries for the next 30 days.
 */
export async function scheduleCheckinNudge(
  userId: string,
  nudgeTime: string, // "HH:MM"
  timezone: string = 'UTC',
): Promise<number> {
  await connectDB()

  // Remove existing pending nudges
  await NotificationSchedule.deleteMany({
    userId,
    type: 'checkin_nudge',
    status: 'pending',
  })

  const entries = []
  const today = todayInTimezone(timezone)

  for (let i = 0; i < 30; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0]

    const scheduledFor = buildScheduledDate(dateStr, nudgeTime, timezone)

    entries.push({
      userId,
      type: 'checkin_nudge',
      scheduledFor,
      payload: {
        title: 'Daily Check-in',
        body: 'How did your habits go today? Tap to log progress.',
        deepLink: '/habits/today',
        habitId: undefined,
      },
      status: 'pending',
    })
  }

  if (entries.length > 0) {
    await NotificationSchedule.insertMany(entries)
  }

  return entries.length
}

/**
 * Creates a one-shot notification entry for streak milestones.
 */
const MILESTONES = [3, 7, 14, 30, 60, 100, 365] as const

export async function scheduleStreakMilestone(
  userId: string,
  habitId: string,
  milestone: number,
): Promise<boolean> {
  if (!MILESTONES.includes(milestone as typeof MILESTONES[number])) {
    return false
  }

  await connectDB()

  // Avoid duplicates
  const existing = await NotificationSchedule.findOne({
    userId,
    type: 'streak_milestone',
    'payload.habitId': habitId,
    'payload.body': { $regex: `${milestone}-day` },
    status: 'pending',
  })

  if (existing) return false

  await NotificationSchedule.create({
    userId,
    type: 'streak_milestone',
    scheduledFor: new Date(), // immediate
    payload: {
      title: 'Streak Milestone!',
      body: `You hit a ${milestone}-day streak! Keep it going!`,
      deepLink: `/habits/${habitId}`,
      habitId,
    },
    status: 'pending',
  })

  return true
}

/**
 * Pushes a scheduled time out of the quiet-hours window.
 * If scheduledFor falls within [quietStart, quietEnd], it gets moved to quietEnd.
 */
export function applyQuietHours(
  scheduledFor: Date,
  quietStart: string, // "HH:MM"
  quietEnd: string,   // "HH:MM"
  timezone: string,
): Date {
  // Get the hour/minute in the user's timezone
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }
  const localTimeStr = scheduledFor.toLocaleTimeString('en-GB', options) // "HH:MM"
  const localMinutes = parseTime(localTimeStr)
  const scheduledMinutes = localMinutes.hours * 60 + localMinutes.minutes

  const startParsed = parseTime(quietStart)
  const endParsed = parseTime(quietEnd)
  const startMinutes = startParsed.hours * 60 + startParsed.minutes
  const endMinutes = endParsed.hours * 60 + endParsed.minutes

  let inQuietHours = false

  if (startMinutes <= endMinutes) {
    // Same day window: e.g. 14:00 - 18:00
    inQuietHours = scheduledMinutes >= startMinutes && scheduledMinutes < endMinutes
  } else {
    // Overnight window: e.g. 22:00 - 07:00
    inQuietHours = scheduledMinutes >= startMinutes || scheduledMinutes < endMinutes
  }

  if (!inQuietHours) return scheduledFor

  // Move to quiet end time
  const diff = endParsed.hours * 60 + endParsed.minutes - scheduledMinutes
  let offsetMinutes = diff
  if (offsetMinutes <= 0) {
    // It's after midnight but before quiet end — just push to quiet end
    offsetMinutes = endMinutes - scheduledMinutes
    if (offsetMinutes <= 0) offsetMinutes += 24 * 60
  }

  return new Date(scheduledFor.getTime() + offsetMinutes * 60 * 1000)
}

/**
 * Enforces a maximum of 5 notifications per user per day.
 * Returns the count of kept notifications. Drops lowest priority (checkin_nudge first).
 */
export async function applyFrequencyCap(
  userId: string,
  date: string, // YYYY-MM-DD
): Promise<number> {
  await connectDB()

  const MAX_PER_DAY = 5
  const dayStart = new Date(date + 'T00:00:00.000Z')
  const dayEnd = new Date(date + 'T23:59:59.999Z')

  const pending = await NotificationSchedule.find({
    userId,
    status: 'pending',
    scheduledFor: { $gte: dayStart, $lte: dayEnd },
  }).sort({ scheduledFor: 1 })

  if (pending.length <= MAX_PER_DAY) return pending.length

  // Priority order: streak_milestone > habit_reminder > checkin_nudge
  const priorityMap: Record<string, number> = {
    streak_milestone: 3,
    habit_reminder: 2,
    checkin_nudge: 1,
  }

  const sorted = [...pending].sort((a, b) => {
    const pa = priorityMap[a.type] ?? 0
    const pb = priorityMap[b.type] ?? 0
    if (pa !== pb) return pb - pa // higher priority first
    return a.scheduledFor.getTime() - b.scheduledFor.getTime()
  })

  // Keep top MAX_PER_DAY, skip the rest
  const toSkip = sorted.slice(MAX_PER_DAY)
  const skipIds = toSkip.map((n) => n._id)

  if (skipIds.length > 0) {
    await NotificationSchedule.updateMany(
      { _id: { $in: skipIds } },
      { $set: { status: 'skipped', skippedReason: 'frequency_cap_exceeded' } },
    )
  }

  return MAX_PER_DAY
}

/**
 * Consolidates 3+ notifications within a windowMinutes-minute window
 * into a single batched notification.
 */
export async function batchNearbyReminders(
  userId: string,
  windowMinutes: number = 30,
): Promise<number> {
  await connectDB()

  const pending = await NotificationSchedule.find({
    userId,
    status: 'pending',
  }).sort({ scheduledFor: 1 })

  if (pending.length < 3) return 0

  let batched = 0
  const windowMs = windowMinutes * 60 * 1000
  let i = 0

  while (i < pending.length) {
    // Find all notifications within windowMinutes of pending[i]
    const windowStart = pending[i].scheduledFor.getTime()
    const windowEnd = windowStart + windowMs
    const cluster = [pending[i]]

    let j = i + 1
    while (j < pending.length && pending[j].scheduledFor.getTime() <= windowEnd) {
      cluster.push(pending[j])
      j++
    }

    if (cluster.length >= 3) {
      // Keep the first one, update its body to mention batching, skip the rest
      const keepId = cluster[0]._id
      const skipIds = cluster.slice(1).map((n) => n._id)

      await NotificationSchedule.findByIdAndUpdate(keepId, {
        $set: {
          'payload.title': 'Habit Reminders',
          'payload.body': `You have ${cluster.length} habits to check in on.`,
        },
      })

      await NotificationSchedule.updateMany(
        { _id: { $in: skipIds } },
        { $set: { status: 'skipped', skippedReason: 'batched_with_nearby' } },
      )

      batched += skipIds.length
      i = j
    } else {
      i++
    }
  }

  return batched
}
