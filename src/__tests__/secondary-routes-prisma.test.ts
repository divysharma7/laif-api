import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const prisma = vi.hoisted(() => ({
  chatSession: {
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
  memory: {
    deleteMany: vi.fn(),
  },
  notificationSchedule: {
    findMany: vi.fn(),
  },
  webPushSubscription: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  device: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({
  getPrisma: () => prisma,
  disconnectPrisma: vi.fn(),
}))

const { createApp } = await import('../app.js')
const { signToken } = await import('../lib/auth.js')

let authorization: string

describe('secondary Prisma route ownership', () => {
  beforeAll(async () => {
    authorization = `Bearer ${await signToken({
      userId: 'owner-123',
      username: 'owner@example.com',
      name: 'Owner',
    })}`
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides a chat session that is not owned by the authenticated user', async () => {
    prisma.chatSession.findFirst.mockResolvedValue(null)

    await request(createApp())
      .get('/api/chat/sessions/not-owned')
      .set('Authorization', authorization)
      .expect(404)

    expect(prisma.chatSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'not-owned', userId: 'owner-123' },
    }))
  })

  it('scopes memory deletion to the authenticated user', async () => {
    prisma.memory.deleteMany.mockResolvedValue({ count: 1 })

    await request(createApp())
      .delete('/api/memories/memory-1')
      .set('Authorization', authorization)
      .expect(200)

    expect(prisma.memory.deleteMany).toHaveBeenCalledWith({
      where: { id: 'memory-1', userId: 'owner-123' },
    })
  })

  it('lists only the authenticated user pending notifications', async () => {
    prisma.notificationSchedule.findMany.mockResolvedValue([])

    await request(createApp())
      .get('/api/notifications')
      .set('Authorization', authorization)
      .expect(200)

    expect(prisma.notificationSchedule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner-123', status: 'pending' },
    }))
  })

  it('attaches web-push subscriptions to the authenticated user', async () => {
    prisma.webPushSubscription.upsert.mockResolvedValue({})
    prisma.webPushSubscription.findUnique.mockResolvedValue(null)

    await request(createApp())
      .post('/api/push/subscribe')
      .set('Authorization', authorization)
      .send({
        subscription: {
          endpoint: 'https://push.example/subscription',
          keys: { p256dh: 'key', auth: 'secret' },
        },
        userAgent: 'test',
      })
      .expect(200)

    expect(prisma.webPushSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: 'owner-123' }),
      update: expect.not.objectContaining({ userId: 'owner-123' }),
    }))
  })

  it('attaches device registrations to the authenticated user', async () => {
    prisma.device.upsert.mockResolvedValue({})
    prisma.device.findUnique.mockResolvedValue(null)

    await request(createApp())
      .post('/api/devices/register')
      .set('Authorization', authorization)
      .send({ fcmToken: 'device-token', platform: 'android' })
      .expect(200)

    expect(prisma.device.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: 'owner-123' }),
      update: expect.not.objectContaining({ userId: 'owner-123' }),
    }))
  })
})
