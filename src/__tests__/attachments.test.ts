import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const prisma = vi.hoisted(() => ({
  task: { findFirst: vi.fn() },
  taskAttachment: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
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

describe('task attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.task.findFirst.mockResolvedValue({ id: 'task-1' })
  })

  it('rejects malformed base64 without writing data', async () => {
    await request(createApp())
      .post('/api/tasks/task-1/attachments')
      .set('Authorization', `Bearer ${await token()}`)
      .send({ filename: 'note.txt', contentType: 'text/plain', dataBase64: 'not base64' })
      .expect(422)

    expect(prisma.taskAttachment.create).not.toHaveBeenCalled()
  })

  it('creates a bounded attachment only after task ownership is verified', async () => {
    prisma.taskAttachment.create.mockResolvedValue({
      id: 'attachment-1',
      filename: 'note.txt',
      contentType: 'text/plain',
      size: 5,
      createdAt: new Date('2026-08-16T00:00:00.000Z'),
    })

    const response = await request(createApp())
      .post('/api/tasks/task-1/attachments')
      .set('Authorization', `Bearer ${await token()}`)
      .send({ filename: 'note.txt', contentType: 'text/plain', dataBase64: 'SGVsbG8=' })
      .expect(201)

    expect(response.body).toMatchObject({ _id: 'attachment-1', size: 5 })
    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: { id: 'task-1', userId: 'user-123' },
      select: { id: true },
    })
    expect(prisma.taskAttachment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ size: 5, data: Uint8Array.from(Buffer.from('Hello')) }),
    }))
  })

  it('does not reveal attachments for a task owned by another user', async () => {
    prisma.task.findFirst.mockResolvedValue(null)

    await request(createApp())
      .get('/api/tasks/other-task/attachments')
      .set('Authorization', `Bearer ${await token()}`)
      .expect(404)

    expect(prisma.taskAttachment.findMany).not.toHaveBeenCalled()
  })
})
