import { getPrisma } from '../lib/prisma.js'
import { isValidIanaTimeZone, localDateKey, utcBoundsForLocalDate } from '../lib/timeZone.js'

function taskLine(task: { title: string; dueDate: Date | null; priority: string | null }) {
  const due = task.dueDate ? `, due ${task.dueDate.toISOString().slice(0, 10)}` : ''
  return `${task.title} (${task.priority ?? 'no priority'}${due})`
}

export async function answerUserLocally(userId: string, message: string) {
  const prisma = getPrisma()
  const now = new Date()
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  })
  const timezone = user?.timezone && isValidIanaTimeZone(user.timezone) ? user.timezone : 'UTC'
  const todayBounds = utcBoundsForLocalDate(localDateKey(now, timezone), timezone)
  // Keep adapter calls sequential: the production Prisma adapter has shown protocol
  // errors when many queries share one connection concurrently.
  const tasks = await prisma.task.findMany({
      where: { userId, isHabit: false, status: { notIn: ['done', 'dropped'] } },
      orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
      take: 100,
      select: { title: true, dueDate: true, priority: true, scheduledStart: true },
    })
  const habits = await prisma.task.findMany({
      where: { userId, isHabit: true, status: { not: 'dropped' } },
      orderBy: { order: 'asc' },
      take: 50,
      select: { title: true, streakCurrent: true },
    })
  const focusRecords = await prisma.focusRecord.findMany({
      where: { userId, deletedAt: null },
      orderBy: { startTime: 'desc' },
      take: 20,
      select: { durationSeconds: true },
    })

  const normalized = message.toLowerCase()
  const overdue = tasks.filter(task => task.dueDate && task.dueDate < now)
  const today = tasks.filter(task => (
    task.dueDate
    && task.dueDate >= todayBounds.start
    && task.dueDate < todayBounds.end
  ))
  const highPriority = tasks.filter(task => task.priority === 'high')
  const focusMinutes = Math.round(
    focusRecords.reduce((sum, record) => sum + record.durationSeconds, 0) / 60,
  )

  if (normalized.includes('overdue')) {
    if (!overdue.length) return 'You have no overdue tasks. Keep today intentionally light.'
    return `You have ${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}. Start with: ${overdue.slice(0, 3).map(taskLine).join('; ')}.`
  }
  if (normalized.includes('habit') || normalized.includes('streak')) {
    if (!habits.length) return 'You have no active habits yet. Start with one habit small enough to repeat tomorrow.'
    const strongest = [...habits].sort((a, b) => b.streakCurrent - a.streakCurrent)[0]
    return `You have ${habits.length} active habits. Your strongest current streak is ${strongest.title} at ${strongest.streakCurrent} day${strongest.streakCurrent === 1 ? '' : 's'}.`
  }
  if (normalized.includes('focus') || normalized.includes('pomodoro')) {
    return `Your recent focus history totals ${focusMinutes} minutes. Pick one clear target and protect a 25-minute block before adding more work.`
  }
  if (normalized.includes('today') || normalized.includes('plan')) {
    const candidates = [...new Set([...overdue, ...today, ...highPriority])].slice(0, 3)
    if (!candidates.length) return 'Your task list has no urgent signal. Choose one meaningful outcome, then protect time for it.'
    return `A calm plan is to finish these in order: ${candidates.map(taskLine).join('; ')}. Move anything else out of today before starting.`
  }
  if (normalized.includes('break down') || normalized.includes('steps')) {
    return 'Use this sequence: define the visible outcome, identify the first 15-minute action, list the two biggest unknowns, then schedule one focused block. Add each action as a subtask so progress stays visible.'
  }
  return `You have ${tasks.length} active tasks, ${overdue.length} overdue, ${habits.length} active habits, and ${focusMinutes} recent focus minutes. Ask me to plan today, inspect overdue work, review habits, or break work into steps.`
}
