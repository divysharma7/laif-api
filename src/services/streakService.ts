// ── Types ───────────────────────────────────────────────────────

interface Completion {
  date: string        // 'YYYY-MM-DD'
  status: string      // 'achieved' | 'unachieved' | 'skipped' | 'frozen'
  value?: number
  reason?: string
  loggedAt?: Date
}

interface HabitFrequency {
  type: string
  daysOfWeek?: number[]
  timesPerWeek?: number
  everyDays?: number
}

interface HabitLike {
  completions?: Completion[]
  habitFrequency?: HabitFrequency | null
  createdAt?: string | Date
}

// ── Helpers ─────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD in a given timezone */
function formatDate(date: Date, timezone: string = 'UTC'): string {
  return date.toLocaleDateString('en-CA', { timeZone: timezone })
}

/** Get today's date string in a timezone */
function todayStr(timezone: string = 'UTC'): string {
  return formatDate(new Date(), timezone)
}

/** Add days to a date string, returns YYYY-MM-DD */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z') // noon to avoid DST issues
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

/** Get day of week (0=Sun) from a YYYY-MM-DD string */
function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00Z').getDay()
}

/** Check if a date is due based on frequency */
function isDateDueByFrequency(
  dateStr: string,
  frequency: HabitFrequency | null | undefined,
  createdDateStr?: string,
): boolean {
  if (!frequency) return true

  switch (frequency.type) {
    case 'daily': {
      if (frequency.daysOfWeek && frequency.daysOfWeek.length > 0) {
        return frequency.daysOfWeek.includes(getDayOfWeek(dateStr))
      }
      return true
    }
    case 'weekly': {
      // Weekly habits are "due" every day — completion logic counts per week
      return true
    }
    case 'interval': {
      if (!frequency.everyDays || !createdDateStr) return true
      const created = new Date(createdDateStr + 'T12:00:00Z').getTime()
      const current = new Date(dateStr + 'T12:00:00Z').getTime()
      const diffDays = Math.floor((current - created) / (24 * 60 * 60 * 1000))
      return diffDays >= 0 && diffDays % frequency.everyDays === 0
    }
    default:
      return true
  }
}

// ── Core functions ──────────────────────────────────────────────

/**
 * Compute current streak by walking completions backwards from today.
 * Counts consecutive days with 'achieved' (or 'frozen') status.
 */
export function computeStreak(habit: HabitLike, timezone: string = 'UTC'): number {
  const completions = habit.completions ?? []
  if (completions.length === 0) return 0

  // Build a map: date -> status
  const statusMap = new Map<string, string>()
  for (const c of completions) {
    statusMap.set(c.date, c.status)
  }

  const createdDateStr = habit.createdAt
    ? formatDate(new Date(habit.createdAt), timezone)
    : undefined

  let streak = 0
  let currentDate = todayStr(timezone)

  // If today has no entry, start from yesterday (day might not be over)
  if (!statusMap.has(currentDate)) {
    currentDate = addDays(currentDate, -1)
  }

  while (true) {
    const status = statusMap.get(currentDate)

    if (!status) {
      // No entry — check if it was a due day
      if (isDateDueByFrequency(currentDate, habit.habitFrequency, createdDateStr)) {
        break // due day missed = streak broken
      }
      // Not a due day, skip it
      currentDate = addDays(currentDate, -1)
      continue
    }

    if (status === 'achieved' || status === 'frozen') {
      streak++
      currentDate = addDays(currentDate, -1)
    } else {
      break // 'unachieved' or 'skipped' breaks the streak
    }
  }

  return streak
}

/**
 * Find the longest run of consecutive 'achieved'/'frozen' in completions.
 */
export function computeBestStreak(habit: HabitLike, timezone: string = 'UTC'): number {
  const completions = habit.completions ?? []
  if (completions.length === 0) return 0

  // Sort completions by date ascending
  const sorted = [...completions].sort((a, b) => a.date.localeCompare(b.date))

  const createdDateStr = habit.createdAt
    ? formatDate(new Date(habit.createdAt), timezone)
    : undefined

  let best = 0
  let current = 0

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]
    if (c.status === 'achieved' || c.status === 'frozen') {
      current++

      // Check if next day is consecutive (accounting for non-due days)
      if (i < sorted.length - 1) {
        let expectedNext = addDays(c.date, 1)
        // Skip non-due days
        while (
          !isDateDueByFrequency(expectedNext, habit.habitFrequency, createdDateStr) &&
          expectedNext < sorted[sorted.length - 1].date
        ) {
          expectedNext = addDays(expectedNext, 1)
        }

        if (sorted[i + 1].date !== expectedNext) {
          // Gap detected
          best = Math.max(best, current)
          current = 0
        }
      }
    } else {
      best = Math.max(best, current)
      current = 0
    }
  }

  best = Math.max(best, current)
  return best
}

/**
 * Check if a habit is due today based on its frequency configuration.
 */
export function isDueToday(
  habit: HabitLike,
  timezone: string = 'UTC',
): boolean {
  const today = todayStr(timezone)
  const createdDateStr = habit.createdAt
    ? formatDate(new Date(habit.createdAt), timezone)
    : undefined

  return isDateDueByFrequency(today, habit.habitFrequency, createdDateStr)
}

/**
 * Returns a grid of 7 * weeks cells with status for display.
 * Each cell: { date: string, dayOfWeek: number, status: string | null }
 */
export function getWeeklyGrid(
  habit: HabitLike,
  weeks: number = 1,
  timezone: string = 'UTC',
): Array<{ date: string; dayOfWeek: number; status: string | null }> {
  const statusMap = new Map<string, string>()
  for (const c of (habit.completions ?? [])) {
    statusMap.set(c.date, c.status)
  }

  const today = todayStr(timezone)
  const todayDow = getDayOfWeek(today)
  const totalDays = weeks * 7

  // Start from the beginning of the current week (Sunday)
  const startDate = addDays(today, -todayDow)

  const grid: Array<{ date: string; dayOfWeek: number; status: string | null }> = []

  // Go backwards for (weeks - 1) weeks, then forward for current week
  const gridStart = addDays(startDate, -(weeks - 1) * 7)

  for (let i = 0; i < totalDays; i++) {
    const dateStr = addDays(gridStart, i)
    const dow = getDayOfWeek(dateStr)
    const status = statusMap.get(dateStr) ?? null
    grid.push({ date: dateStr, dayOfWeek: dow, status })
  }

  return grid
}

/**
 * Calculate the completion rate over the last N days.
 * Returns a number between 0 and 1 (percentage as decimal).
 */
export function getCompletionRate(
  habit: HabitLike,
  days: number = 30,
  timezone: string = 'UTC',
): number {
  const statusMap = new Map<string, string>()
  for (const c of (habit.completions ?? [])) {
    statusMap.set(c.date, c.status)
  }

  const createdDateStr = habit.createdAt
    ? formatDate(new Date(habit.createdAt), timezone)
    : undefined

  const today = todayStr(timezone)
  let totalDue = 0
  let totalAchieved = 0

  for (let i = 0; i < days; i++) {
    const dateStr = addDays(today, -i)

    // Don't count days before the habit was created
    if (createdDateStr && dateStr < createdDateStr) break

    if (!isDateDueByFrequency(dateStr, habit.habitFrequency, createdDateStr)) {
      continue
    }

    totalDue++
    const status = statusMap.get(dateStr)
    if (status === 'achieved' || status === 'frozen') {
      totalAchieved++
    }
  }

  if (totalDue === 0) return 0
  return totalAchieved / totalDue
}
