import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const prisma = vi.hoisted(() => ({
  task: { count: vi.fn(), findMany: vi.fn() },
  focusRecord: { aggregate: vi.fn(), findMany: vi.fn() },
  habitCompletion: { findMany: vi.fn() },
  list: { count: vi.fn(), findMany: vi.fn() },
}))

vi.mock('../lib/prisma.js', () => ({
  getPrisma: () => prisma,
  disconnectPrisma: vi.fn(),
}))

const { createApp } = await import('../app.js')
const { signToken } = await import('../lib/auth.js')

describe('consolidated statistics', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    prisma.task.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(8)
      .mockResolvedValue(1)
    prisma.task.findMany
      .mockResolvedValueOnce([{ completedAt: new Date() }])
      .mockResolvedValueOnce([{ id: 'habit-1', title: 'Walk', streakCurrent: 3, streakBest: 7 }])
      .mockResolvedValueOnce([{ completedAt: new Date() }])
      .mockResolvedValue([])
    prisma.focusRecord.aggregate.mockResolvedValue({
      _sum: { durationSeconds: 7200, pomoCount: 4 },
      _count: { id: 4 },
    })
    prisma.focusRecord.findMany
      .mockResolvedValueOnce([{ startTime: new Date(), durationSeconds: 1500, pomoCount: 1 }])
      .mockResolvedValueOnce([{ startTime: new Date() }])
      .mockResolvedValue([])
    prisma.habitCompletion.findMany.mockResolvedValue([{ date: new Date(), status: 'achieved' }])
    prisma.list.count.mockResolvedValue(2)
    prisma.list.findMany.mockResolvedValue([])
  })

  it('returns user-owned task, focus, and habit metrics', async () => {
    const token = await signToken({ userId: 'user-123', username: 'person@example.com', name: 'Person' })
    const response = await request(createApp())
      .get('/api/v1/statistics/overview?days=7&timezone=UTC')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(response.body).toMatchObject({
      tasks: { completed: 12, completedInRange: 4, open: 8 },
      focus: { sessions: 4, totalMinutes: 120, minutesInRange: 25 },
      habits: { active: 1, achievedInRange: 1, bestStreak: 7 },
    })
    expect(response.body.daily).toHaveLength(7)
    expect(prisma.task.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-123' }),
    }))
  })

  it('rejects an invalid time zone', async () => {
    const token = await signToken({ userId: 'user-123', username: 'person@example.com', name: 'Person' })
    await request(createApp())
      .get('/api/v1/statistics/overview?timezone=not-a-zone')
      .set('Authorization', `Bearer ${token}`)
      .expect(422)
  })

  it('returns owned task analytics without double-counting tasks due and completed in the period', async () => {
    prisma.task.findMany.mockReset()
    prisma.list.findMany.mockReset()

    prisma.task.findMany
      .mockResolvedValueOnce([
        {
          id: 'done-1',
          dueDate: new Date('2026-08-16T00:00:00.000Z'),
          completedAt: new Date('2026-08-16T20:00:00.000Z'),
          listId: 'list-1',
        },
        {
          id: 'done-2',
          dueDate: null,
          completedAt: new Date('2026-08-16T12:00:00.000Z'),
          listId: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'done-1',
          status: 'done',
          dueDate: new Date('2026-08-16T00:00:00.000Z'),
          completedAt: new Date('2026-08-16T20:00:00.000Z'),
        },
        {
          id: 'open-1',
          status: 'todo',
          dueDate: new Date('2026-08-16T08:00:00.000Z'),
          completedAt: null,
        },
      ])
      .mockResolvedValueOnce([{ id: 'previous-done' }])
      .mockResolvedValueOnce([
        {
          id: 'previous-done',
          status: 'done',
          dueDate: new Date('2026-08-15T08:00:00.000Z'),
          completedAt: new Date('2026-08-15T10:00:00.000Z'),
        },
        {
          id: 'previous-open',
          status: 'todo',
          dueDate: new Date('2026-08-15T12:00:00.000Z'),
          completedAt: null,
        },
      ])
    prisma.list.findMany.mockResolvedValue([{ id: 'list-1', title: 'Work' }])

    const token = await signToken({ userId: 'user-123', username: 'person@example.com', name: 'Person' })
    const response = await request(createApp())
      .get('/api/v1/statistics/task?range=day&date=2026-08-16&timezone=UTC')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(response.body).toMatchObject({
      current: {
        completedTasks: 2,
        completionRate: 67,
        onTimeTasks: 1,
        overdueTasks: 0,
        undatedTasks: 1,
        uncompletedTasks: 1,
        totalApplicable: 3,
        byList: [
          { listId: 'list-1', listName: 'Work', count: 1 },
          { listId: null, listName: 'No List', count: 1 },
        ],
      },
      previous: { completedTasks: 1, completionRate: 50 },
      range: {
        type: 'day',
        currentStart: '2026-08-16',
        currentEnd: '2026-08-16',
        previousStart: '2026-08-15',
        previousEnd: '2026-08-15',
        timezone: 'UTC',
      },
    })
    expect(response.body.current.dailyCompletions).toEqual([
      { date: '2026-08-16', count: 2 },
    ])
    expect(prisma.list.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['list-1'] }, ownerId: 'user-123' },
      select: { id: true, title: true },
    })
  })

  it('rejects an impossible task statistics date before querying data', async () => {
    const token = await signToken({ userId: 'user-123', username: 'person@example.com', name: 'Person' })
    await request(createApp())
      .get('/api/v1/statistics/task?range=day&date=2026-99-99&timezone=UTC')
      .set('Authorization', `Bearer ${token}`)
      .expect(422)

    expect(prisma.task.findMany).not.toHaveBeenCalled()
  })
})
