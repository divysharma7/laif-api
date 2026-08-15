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
    vi.clearAllMocks()
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
})
