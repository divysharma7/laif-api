import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const prisma = vi.hoisted(() => ({
  dailyRitual: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  notificationSchedule: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  getPrisma: () => prisma,
  disconnectPrisma: vi.fn(),
}))

const { createApp } = await import('../app.js')
const { signToken } = await import('../lib/auth.js')

async function authToken() {
  return signToken({ userId: 'user-123', username: 'person@example.com', name: 'Person' })
}

describe('daily ritual contract', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    prisma.$transaction.mockImplementation(async (callback: (client: typeof prisma) => unknown) => callback(prisma))
    prisma.dailyRitual.findMany.mockResolvedValue([])
    prisma.notificationSchedule.deleteMany.mockResolvedValue({ count: 0 })
    prisma.notificationSchedule.createMany.mockResolvedValue({ count: 0 })
  })

  it('returns one combined, user-scoped state for a date', async () => {
    prisma.dailyRitual.findMany.mockResolvedValue([
      {
        type: 'morning',
        outcome: 'Ship the release',
        payload: { acceptedWindows: ['09:00-10:00'], planCompleted: true },
      },
      {
        type: 'evening',
        outcome: null,
        payload: { taskDecisions: { 'task-1': 'complete' }, shutdownCompleted: true },
      },
    ])

    const response = await request(createApp())
      .get('/api/rituals?date=2026-08-16')
      .set('Authorization', `Bearer ${await authToken()}`)
      .expect(200)

    expect(response.body).toEqual({
      date: '2026-08-16',
      outcome: 'Ship the release',
      acceptedWindows: ['09:00-10:00'],
      planCompleted: true,
      taskDecisions: { 'task-1': 'complete' },
      shutdownCompleted: true,
    })
    expect(prisma.dailyRitual.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-123' }),
    }))
  })

  it('rejects an invalid date before querying ritual data', async () => {
    await request(createApp())
      .get('/api/rituals?date=not-a-date')
      .set('Authorization', `Bearer ${await authToken()}`)
      .expect(422)

    expect(prisma.dailyRitual.findMany).not.toHaveBeenCalled()
  })

  it('applies close-day task decisions and completion in one transaction', async () => {
    prisma.dailyRitual.findUnique.mockResolvedValue(null)
    prisma.task.findMany.mockResolvedValue([
      { id: 'task-1', title: 'Finish audit', reminders: [] },
      { id: 'task-2', title: 'Plan tomorrow', reminders: [] },
    ])
    prisma.task.update
      .mockResolvedValueOnce({ id: 'task-1', title: 'Finish audit', reminders: [] })
      .mockResolvedValueOnce({ id: 'task-2', title: 'Plan tomorrow', reminders: [] })
    prisma.dailyRitual.upsert.mockResolvedValue({ id: 'ritual-1' })
    prisma.dailyRitual.findMany.mockResolvedValue([
      {
        type: 'evening',
        outcome: null,
        payload: {
          taskDecisions: { 'task-1': 'complete', 'task-2': 'move' },
          shutdownCompleted: true,
        },
      },
    ])

    const response = await request(createApp())
      .post('/api/rituals/close-day')
      .set('Authorization', `Bearer ${await authToken()}`)
      .send({
        date: '2026-08-16',
        commandId: 'close-2026-08-16-1',
        decisions: [
          { taskId: 'task-1', action: 'complete' },
          {
            taskId: 'task-2',
            action: 'move',
            scheduledStart: '2026-08-17T09:00:00.000Z',
            scheduledEnd: '2026-08-17T10:00:00.000Z',
          },
        ],
      })
      .expect(200)

    expect(response.body.shutdownCompleted).toBe(true)
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-123', id: { in: ['task-1', 'task-2'] } },
    }))
    expect(prisma.task.update).toHaveBeenCalledTimes(2)
    expect(prisma.dailyRitual.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        payload: expect.objectContaining({
          shutdownCompleted: true,
          shutdownCommandId: 'close-2026-08-16-1',
        }),
      }),
    }))
  })

  it('does not mutate any task when one decision references another user task', async () => {
    prisma.dailyRitual.findUnique.mockResolvedValue(null)
    prisma.task.findMany.mockResolvedValue([{ id: 'task-1', title: 'Owned', reminders: [] }])

    await request(createApp())
      .post('/api/rituals/close-day')
      .set('Authorization', `Bearer ${await authToken()}`)
      .send({
        date: '2026-08-16',
        commandId: 'close-2026-08-16-2',
        decisions: [
          { taskId: 'task-1', action: 'complete' },
          { taskId: 'other-user-task', action: 'drop' },
        ],
      })
      .expect(404)

    expect(prisma.task.update).not.toHaveBeenCalled()
    expect(prisma.dailyRitual.upsert).not.toHaveBeenCalled()
  })
})
