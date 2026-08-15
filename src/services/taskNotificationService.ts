import type { Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../lib/prisma.js'
import { isValidIanaTimeZone, localDateKey, utcForLocalDateTime } from '../lib/timeZone.js'

type TaskWithReminders = {
  id?: string
  title?: string
  dueDate?: Date | null
  scheduledStart?: Date | null
  reminders?: Array<{
    id: string
    type: 'before_start' | 'on_day_at' | 'absolute'
    offsetMinutes: number
    timeOfDay?: string | null
    absoluteTime?: Date | null
    sent?: boolean
  }>
}

function reminderTime(
  task: TaskWithReminders,
  reminder: NonNullable<TaskWithReminders['reminders']>[number],
  timeZone: string,
): Date | null {
  if (reminder.type === 'absolute') return reminder.absoluteTime ?? null
  const base = task.scheduledStart ?? task.dueDate
  if (!base) return null
  if (reminder.type === 'before_start') {
    return new Date(base.getTime() - reminder.offsetMinutes * 60_000)
  }
  if (!reminder.timeOfDay) return base
  const [hours, minutes] = reminder.timeOfDay.split(':').map(Number)
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  return utcForLocalDateTime(localDateKey(base, timeZone), reminder.timeOfDay, timeZone)
}

export async function replaceTaskNotificationSchedules(
  userId: string,
  task: TaskWithReminders,
  prisma: Pick<Prisma.TransactionClient, 'notificationSchedule' | 'user'> = getPrisma(),
) {
  if (!task.id || !task.title) return
  await prisma.notificationSchedule.deleteMany({
    where: {
      userId,
      status: 'pending',
      payload: { path: ['taskId'], equals: task.id },
    },
  })

  let timeZone = 'UTC'
  if ((task.reminders ?? []).some(reminder => reminder.type === 'on_day_at' && reminder.timeOfDay)) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    })
    if (user?.timezone && isValidIanaTimeZone(user.timezone)) timeZone = user.timezone
  }
  const now = new Date()
  const schedules = (task.reminders ?? []).flatMap(reminder => {
    const scheduledFor = reminderTime(task, reminder, timeZone)
    if (reminder.sent || !scheduledFor || scheduledFor <= now) return []
    return [{
      userId,
      type: 'task_reminder' as const,
      scheduledFor,
      payload: {
        taskId: task.id,
        reminderId: reminder.id,
        title: task.title,
      } satisfies Prisma.InputJsonValue,
    }]
  })
  if (schedules.length) {
    await prisma.notificationSchedule.createMany({ data: schedules })
  }
}
