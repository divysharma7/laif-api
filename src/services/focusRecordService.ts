import { getPrisma } from '../lib/prisma.js'
import { localDateKey, utcBoundsForLocalDate } from '../lib/timeZone.js'
import type { FocusMode, FocusTargetType, FocusRecordSource } from '../generated/prisma/client.js'

interface CreateRecordInput {
  userId: string
  targetType: FocusTargetType
  targetId?: string | null
  targetTitleSnapshot?: string | null
  startTime: Date
  endTime: Date
  durationSeconds: number
  mode: FocusMode
  pomoCount?: number
  note?: string | null
  source?: FocusRecordSource
  timezone?: string | null
}

interface RecordFilters {
  userId: string
  cursor?: string
  limit?: number
}

interface OverviewResult {
  todayPomo: number
  todayFocusSeconds: number
  totalPomo: number
  totalFocusSeconds: number
}

export async function createRecord(input: CreateRecordInput) {
  const prisma = getPrisma()

  // Resolve target title snapshot if not provided
  let titleSnapshot = input.targetTitleSnapshot
  if (!titleSnapshot && input.targetId && input.targetType !== 'NONE') {
    const task = await prisma.task.findFirst({
      where: { id: input.targetId, userId: input.userId },
      select: { title: true },
    })
    titleSnapshot = task?.title ?? null
  }

  return prisma.focusRecord.create({
    data: {
      userId: input.userId,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetTitleSnapshot: titleSnapshot,
      startTime: input.startTime,
      endTime: input.endTime,
      durationSeconds: input.durationSeconds,
      mode: input.mode,
      pomoCount: input.pomoCount ?? (input.mode === 'POMO' ? 1 : 0),
      note: input.note ?? null,
      source: input.source ?? 'TIMER',
      timezone: input.timezone ?? null,
    },
  })
}

export async function getRecords({ userId, cursor, limit = 50 }: RecordFilters) {
  const prisma = getPrisma()

  const where: Record<string, unknown> = {
    userId,
    deletedAt: null,
  }

  if (cursor) {
    const cursorRecord = await prisma.focusRecord.findFirst({
      where: { id: cursor, userId },
      select: { startTime: true },
    })
    if (cursorRecord) {
      where.startTime = { lt: cursorRecord.startTime }
    }
  }

  const records = await prisma.focusRecord.findMany({
    where,
    orderBy: { startTime: 'desc' },
    take: limit + 1,
  })

  const hasMore = records.length > limit
  const items = hasMore ? records.slice(0, limit) : records
  const nextCursor = hasMore ? items[items.length - 1].id : null

  return { items, nextCursor, hasMore }
}

export async function getOverview(userId: string, timezone?: string): Promise<OverviewResult> {
  const prisma = getPrisma()

  // Use provided timezone or fall back to UTC
  const tz = timezone || 'UTC'

  // Attribute records to the local date on which they started.
  const now = new Date()
  const today = localDateKey(now, tz)
  const { start: todayStart, end: tomorrowStart } = utcBoundsForLocalDate(today, tz)

  const [todayRecords, allRecords] = await Promise.all([
    prisma.focusRecord.findMany({
      where: {
        userId,
        deletedAt: null,
        startTime: { gte: todayStart, lt: tomorrowStart },
      },
      select: { pomoCount: true, durationSeconds: true },
    }),
    prisma.focusRecord.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      select: { pomoCount: true, durationSeconds: true },
    }),
  ])

  const todayPomo = todayRecords.reduce((sum, r) => sum + r.pomoCount, 0)
  const todayFocusSeconds = todayRecords.reduce((sum, r) => sum + r.durationSeconds, 0)
  const totalPomo = allRecords.reduce((sum, r) => sum + r.pomoCount, 0)
  const totalFocusSeconds = allRecords.reduce((sum, r) => sum + r.durationSeconds, 0)

  return { todayPomo, todayFocusSeconds, totalPomo, totalFocusSeconds }
}

export async function deleteRecord(userId: string, recordId: string) {
  const prisma = getPrisma()

  const record = await prisma.focusRecord.findFirst({
    where: { id: recordId, userId, deletedAt: null },
  })

  if (!record) {
    throw new Error('Focus record not found')
  }

  return prisma.focusRecord.update({
    where: { id: recordId },
    data: { deletedAt: new Date() },
  })
}

export async function getRecordById(userId: string, recordId: string) {
  const prisma = getPrisma()

  return prisma.focusRecord.findFirst({
    where: { id: recordId, userId, deletedAt: null },
  })
}

export async function getRecordsByDateRange(
  userId: string,
  startDate: Date,
  endDate: Date,
) {
  const prisma = getPrisma()

  return prisma.focusRecord.findMany({
    where: {
      userId,
      deletedAt: null,
      startTime: { gte: startDate },
      endTime: { lte: endDate },
    },
    orderBy: { startTime: 'desc' },
  })
}

export async function getAggregatedStats(
  userId: string,
  groupBy: 'day' | 'week' | 'month',
  limit: number = 30,
  timezone: string = 'UTC',
) {
  const prisma = getPrisma()

  const records = await prisma.focusRecord.findMany({
    where: { userId, deletedAt: null },
    select: {
      startTime: true,
      durationSeconds: true,
      pomoCount: true,
      mode: true,
      targetType: true,
      targetId: true,
      targetTitleSnapshot: true,
    },
    orderBy: { startTime: 'desc' },
  })

  // Group by the specified period
  const grouped: Record<string, { durationSeconds: number; pomoCount: number; count: number }> = {}

  for (const record of records) {
    let key: string
    const localDay = localDateKey(new Date(record.startTime), timezone)

    if (groupBy === 'day') {
      key = localDay
    } else if (groupBy === 'week') {
      const weekStart = new Date(`${localDay}T00:00:00.000Z`)
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay())
      key = weekStart.toISOString().slice(0, 10)
    } else {
      key = localDay.slice(0, 7)
    }

    if (!grouped[key]) {
      grouped[key] = { durationSeconds: 0, pomoCount: 0, count: 0 }
    }
    grouped[key].durationSeconds += record.durationSeconds
    grouped[key].pomoCount += record.pomoCount
    grouped[key].count += 1
  }

  // Convert to sorted array
  const result = Object.entries(grouped)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, limit)
    .map(([period, stats]) => ({
      period,
      ...stats,
    }))

  return result
}

export async function getTopTargets(
  userId: string,
  targetType: 'TASK' | 'HABIT',
  limit: number = 10,
) {
  const prisma = getPrisma()

  const records = await prisma.focusRecord.findMany({
    where: {
      userId,
      deletedAt: null,
      targetType,
      targetId: { not: null },
    },
    select: {
      targetId: true,
      targetTitleSnapshot: true,
      durationSeconds: true,
      pomoCount: true,
    },
  })

  // Group by target
  const grouped: Record<string, { title: string; durationSeconds: number; pomoCount: number; count: number }> = {}

  for (const record of records) {
    const key = record.targetId!
    if (!grouped[key]) {
      grouped[key] = {
        title: record.targetTitleSnapshot || 'Unknown',
        durationSeconds: 0,
        pomoCount: 0,
        count: 0,
      }
    }
    grouped[key].durationSeconds += record.durationSeconds
    grouped[key].pomoCount += record.pomoCount
    grouped[key].count += 1
  }

  // Sort by duration and return top N
  return Object.entries(grouped)
    .sort(([, a], [, b]) => b.durationSeconds - a.durationSeconds)
    .slice(0, limit)
    .map(([targetId, stats]) => ({
      targetId,
      ...stats,
    }))
}

export async function getFocusByHourOfDay(userId: string, timezone: string = 'UTC') {
  const prisma = getPrisma()

  const records = await prisma.focusRecord.findMany({
    where: { userId, deletedAt: null },
    select: { startTime: true, durationSeconds: true },
  })

  // Initialize hours 0-23
  const hourDistribution = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    totalSeconds: 0,
    sessionCount: 0,
  }))
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  })

  for (const record of records) {
    const hour = Number(hourFormatter.format(new Date(record.startTime)))
    hourDistribution[hour].totalSeconds += record.durationSeconds
    hourDistribution[hour].sessionCount += 1
  }

  return hourDistribution
}
