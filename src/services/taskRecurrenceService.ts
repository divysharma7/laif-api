import type { Prisma } from '../generated/prisma/client.js'
import { getPrisma } from '../lib/prisma.js'
import { replaceTaskNotificationSchedules } from './taskNotificationService.js'

type TaskRecord = Record<string, any>
type TaskRecurrenceClient = Pick<Prisma.TransactionClient, 'task' | 'notificationSchedule' | 'user'>

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2002'
}

function addMonthsClamped(value: Date, months: number): Date {
  const next = new Date(value)
  const day = next.getUTCDate()
  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + months)
  const finalDay = new Date(Date.UTC(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    0,
  )).getUTCDate()
  next.setUTCDate(Math.min(day, finalDay))
  return next
}

export function nextRecurringDate(
  value: Date | null | undefined,
  repeat: string,
): Date | null {
  if (!value) return null
  const next = new Date(value)
  if (repeat === 'daily') next.setUTCDate(next.getUTCDate() + 1)
  else if (repeat === 'weekdays') {
    do next.setUTCDate(next.getUTCDate() + 1)
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6)
  } else if (repeat === 'weekly') next.setUTCDate(next.getUTCDate() + 7)
  else if (repeat === 'monthly') return addMonthsClamped(next, 1)
  else if (repeat === 'yearly') return addMonthsClamped(next, 12)
  else return null
  return next
}

export async function rollForwardRecurringTask(
  userId: string,
  task: TaskRecord,
  prisma: TaskRecurrenceClient = getPrisma(),
) {
  if (!task.repeat) return null
  const nextDueDate = nextRecurringDate(task.dueDate, task.repeat)
  const nextScheduledStart = nextRecurringDate(task.scheduledStart, task.repeat)
  if (!nextDueDate && !nextScheduledStart) return null
  const nextScheduledEnd = task.scheduledStart && task.scheduledEnd && nextScheduledStart
    ? new Date(nextScheduledStart.getTime() + (task.scheduledEnd.getTime() - task.scheduledStart.getTime()))
    : null
  const clientCommandId = `recurrence:${task.id}`
  const existing = await prisma.task.findFirst({
    where: { userId, clientCommandId },
    select: { id: true },
  })
  if (existing) return existing

  try {
    const nextTask = await prisma.task.create({
      data: {
        userId,
        clientCommandId,
        title: task.title,
        description: task.description,
        notes: task.notes,
        dueDate: nextDueDate,
        priority: task.priority,
        status: 'todo',
        color: task.color,
        tags: task.tags,
        repeat: task.repeat,
        scheduledStart: nextScheduledStart,
        scheduledEnd: nextScheduledEnd,
        estimatedEffort: task.estimatedEffort,
        listId: task.listId,
        parentId: task.parentId,
        workflowId: task.workflowId,
        sectionId: task.sectionId,
        kanbanOrder: task.kanbanOrder,
        reminders: {
          create: (task.reminders ?? []).map((reminder: TaskRecord) => ({
            type: reminder.type,
            offsetMinutes: reminder.offsetMinutes,
            timeOfDay: reminder.timeOfDay,
            absoluteTime: nextRecurringDate(reminder.absoluteTime, task.repeat),
            sent: false,
          })),
        },
        activities: {
          create: {
            action: 'recurrence_created',
            detail: `Created from completed task ${task.id}`,
            timestamp: new Date(),
          },
        },
      } as any,
      include: { reminders: true },
    })
    await replaceTaskNotificationSchedules(userId, nextTask, prisma)
    return nextTask
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    return prisma.task.findFirst({
      where: { userId, clientCommandId },
      select: { id: true },
    })
  }
}
