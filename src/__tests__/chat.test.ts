import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const prisma = vi.hoisted(() => ({
  chatSession: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  chatSessionMessage: {
    count: vi.fn(),
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  getPrisma: () => prisma,
  disconnectPrisma: vi.fn(),
}))

vi.mock('../services/assistantService.js', () => ({
  answerUserLocally: vi.fn().mockResolvedValue('Start with the release checklist.'),
}))

const { createApp } = await import('../app.js')
const { signToken } = await import('../lib/auth.js')

async function token() {
  return signToken({ userId: 'user-123', username: 'person@example.com', name: 'Person' })
}

describe('chat contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.$transaction.mockImplementation(async (callback: (client: typeof prisma) => unknown) => callback(prisma))
    prisma.chatSessionMessage.count.mockResolvedValue(54)
    prisma.chatSessionMessage.createMany.mockResolvedValue({ count: 2 })
    prisma.chatSession.update.mockResolvedValue({ id: 'session-1' })
  })

  it('returns an array of user-owned session summaries with message counts', async () => {
    prisma.chatSession.findMany.mockResolvedValue([{
      id: 'session-1',
      title: 'Release plan',
      createdAt: new Date('2026-08-16T00:00:00.000Z'),
      updatedAt: new Date('2026-08-16T01:00:00.000Z'),
      _count: { messages: 6 },
    }])

    const response = await request(createApp())
      .get('/api/chat/sessions')
      .set('Authorization', `Bearer ${await token()}`)
      .expect(200)

    expect(response.body).toMatchObject([{ _id: 'session-1', messageCount: 6 }])
    expect(prisma.chatSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-123' },
    }))
  })

  it('accepts one message, appends an ordered turn, and returns JSON', async () => {
    prisma.chatSession.findFirst.mockResolvedValue({ id: 'session-1' })

    const response = await request(createApp())
      .post('/api/chat')
      .set('Authorization', `Bearer ${await token()}`)
      .send({ message: 'Plan my day', sessionId: 'session-1' })
      .expect(200)

    expect(response.body).toEqual({
      reply: 'Start with the release checklist.',
      sessionId: 'session-1',
    })
    expect(prisma.chatSessionMessage.createMany).toHaveBeenCalledWith({
      data: [
        { sessionId: 'session-1', position: 54, role: 'user', content: 'Plan my day' },
        {
          sessionId: 'session-1',
          position: 55,
          role: 'assistant',
          content: 'Start with the release checklist.',
        },
      ],
    })
  })

  it('does not append to a session owned by another user', async () => {
    prisma.chatSession.findFirst.mockResolvedValue(null)

    await request(createApp())
      .post('/api/chat')
      .set('Authorization', `Bearer ${await token()}`)
      .send({ message: 'Plan my day', sessionId: 'other-session' })
      .expect(404)

    expect(prisma.chatSessionMessage.createMany).not.toHaveBeenCalled()
  })

  it('rejects the obsolete message-history request shape', async () => {
    await request(createApp())
      .post('/api/chat')
      .set('Authorization', `Bearer ${await token()}`)
      .send({ messages: [{ role: 'user', content: 'Plan my day' }] })
      .expect(400)

    expect(prisma.chatSession.findFirst).not.toHaveBeenCalled()
  })
})
