import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const prisma = vi.hoisted(() => ({
  list: {
    findFirst: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ getPrisma: () => prisma }))

const { createApp } = await import('../app.js')
const { signToken } = await import('../lib/auth.js')

let authorization: string

describe('folder task ownership', () => {
  beforeAll(async () => {
    authorization = `Bearer ${await signToken({
      userId: 'owner-123',
      username: 'owner@example.com',
    })}`
  })

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.$transaction.mockImplementation(async (operation: (client: typeof prisma) => unknown) => operation(prisma))
  })

  it('moves a task only after scoping both the folder and task to the owner', async () => {
    prisma.list.findFirst.mockResolvedValue({ id: 'folder-1', ownerId: 'owner-123' })
    prisma.task.findFirst.mockResolvedValue({ id: 'task-1', userId: 'owner-123' })
    prisma.task.update.mockResolvedValue({
      id: 'task-1',
      userId: 'owner-123',
      listId: 'folder-1',
      comments: [],
      reminders: [],
      completions: [],
      activities: [],
    })

    const response = await request(createApp())
      .patch('/api/folders/folder-1/tasks')
      .set('Authorization', authorization)
      .send({ taskId: 'task-1' })
      .expect(200)

    expect(prisma.list.findFirst).toHaveBeenCalledWith({
      where: { id: 'folder-1', ownerId: 'owner-123' },
    })
    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: { id: 'task-1', userId: 'owner-123' },
    })
    expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-1' },
      data: { listId: 'folder-1' },
    }))
    expect(response.body).toMatchObject({
      _id: 'task-1',
      userId: 'owner-123',
      listId: 'folder-1',
    })
  })

  it('does not move another user’s task into an owned folder', async () => {
    prisma.list.findFirst.mockResolvedValue({ id: 'folder-1', ownerId: 'owner-123' })
    prisma.task.findFirst.mockResolvedValue(null)

    await request(createApp())
      .patch('/api/folders/folder-1/tasks')
      .set('Authorization', authorization)
      .send({ taskId: 'other-user-task' })
      .expect(500)

    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: { id: 'other-user-task', userId: 'owner-123' },
    })
    expect(prisma.task.update).not.toHaveBeenCalled()
  })
})
