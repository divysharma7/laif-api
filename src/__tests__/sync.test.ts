import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const prisma = vi.hoisted(() => ({
  task: { findMany: vi.fn() },
  taskTombstone: { findMany: vi.fn() },
}))

vi.mock('../lib/prisma.js', () => ({
  getPrisma: () => prisma,
  disconnectPrisma: vi.fn(),
}))

const { createApp } = await import('../app.js')
const { signToken } = await import('../lib/auth.js')

async function token() {
  return signToken({ userId: 'user-123', username: 'person@example.com', name: 'Person' })
}

describe('incremental task sync', () => {
  beforeEach(() => vi.clearAllMocks())

  it('paginates a merged task/tombstone stream without advancing past unread changes', async () => {
    const timestamp = new Date('2026-08-16T01:00:00.000Z')
    prisma.task.findMany.mockResolvedValue([
      { id: 'task-a', status: 'todo', updatedAt: timestamp, title: 'A' },
      { id: 'task-b', status: 'in_progress', updatedAt: timestamp, title: 'B' },
    ])
    prisma.taskTombstone.findMany.mockResolvedValue([
      { taskId: 'task-c', deletedAt: timestamp },
    ])

    const first = await request(createApp())
      .get('/api/sync/tasks?cursor=2026-08-16T00:00:00.000Z&limit=2')
      .set('Authorization', `Bearer ${await token()}`)
      .expect(200)

    expect(first.body.hasMore).toBe(true)
    expect(first.body.changes.map((task: { _id: string }) => task._id)).toEqual(['task-a', 'task-b'])
    expect(first.body.tombstones).toEqual([])
    expect(first.body.nextCursor).toEqual(expect.any(String))
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-123' }),
      take: 3,
    }))

    prisma.task.findMany.mockResolvedValue([])
    prisma.taskTombstone.findMany.mockResolvedValue([
      { taskId: 'task-c', deletedAt: timestamp },
    ])
    const second = await request(createApp())
      .get(`/api/sync/tasks?cursor=${encodeURIComponent(first.body.nextCursor)}&limit=2`)
      .set('Authorization', `Bearer ${await token()}`)
      .expect(200)

    expect(second.body.hasMore).toBe(false)
    expect(second.body.tombstones).toMatchObject([{ taskId: 'task-c' }])
  })

  it('rejects an invalid cursor and limit before querying data', async () => {
    await request(createApp())
      .get('/api/sync/tasks?cursor=not-a-cursor&limit=0')
      .set('Authorization', `Bearer ${await token()}`)
      .expect(422)

    expect(prisma.task.findMany).not.toHaveBeenCalled()
    expect(prisma.taskTombstone.findMany).not.toHaveBeenCalled()
  })
})
