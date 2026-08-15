import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import bcryptjs from 'bcryptjs'

const prisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({
  getPrisma: () => prisma,
  disconnectPrisma: vi.fn(),
}))

const { createApp } = await import('../app.js')

describe('application health and authentication boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports a healthy service without authentication', async () => {
    const response = await request(createApp()).get('/health').expect(200)

    expect(response.body).toEqual({ status: 'ok' })
    expect(response.headers['x-request-id']).toBeTruthy()
  })

  it.each(['/api/tasks', '/api/v1/tasks'])(
    'rejects an unauthenticated request to %s',
    async (path) => {
      const response = await request(createApp()).get(path).expect(401)

      expect(response.body).toEqual({ error: 'Unauthorized' })
    },
  )

  it('rejects malformed bearer credentials', async () => {
    const response = await request(createApp())
      .get('/api/tasks')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401)

    expect(response.body).toEqual({ error: 'Unauthorized' })
  })

  it('validates required login fields before accessing a user record', async () => {
    const response = await request(createApp())
      .post('/api/auth/login')
      .send({ username: 'person@example.com' })
      .expect(400)

    expect(response.body).toEqual({ error: 'Username and password are required' })
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('normalizes the login identifier and returns a generic failure for an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValue(null)

    const response = await request(createApp())
      .post('/api/auth/login')
      .send({ email: '  Person@Example.COM ', password: 'not-the-password' })
      .expect(401)

    expect(response.body).toEqual({ error: 'Invalid credentials' })
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { username: 'person@example.com' } })
  })

  it('returns a token and secure cookie after a valid login', async () => {
    const passwordHash = await bcryptjs.hash('correct-password', 4)
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      username: 'person@example.com',
      name: 'Person',
      passwordHash,
    })

    const response = await request(createApp())
      .post('/api/auth/login')
      .send({ username: 'Person@Example.com', password: 'correct-password' })
      .expect(200)

    expect(response.body).toMatchObject({
      ok: true,
      id: 'user-123',
      username: 'person@example.com',
      name: 'Person',
      timezone: 'UTC',
      onboardingState: {},
      gettingStartedState: {},
      onboardingRequired: false,
    })
    expect(response.body.token).toEqual(expect.any(String))
    expect(response.headers['set-cookie']?.[0]).toContain('pim_token=')
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly')
  })

  it('rejects a short signup password before accessing the database', async () => {
    const response = await request(createApp())
      .post('/api/auth/signup')
      .send({ email: 'person@example.com', password: 'short' })
      .expect(400)

    expect(response.body).toEqual({ error: 'Password must be at least 6 characters' })
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('returns the authenticated user for a valid bearer token', async () => {
    const { signToken } = await import('../lib/auth.js')
    const token = await signToken({
      userId: 'user-123',
      username: 'person@example.com',
      name: 'Person',
    })
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      username: 'person@example.com',
      name: 'Person',
    })

    const response = await request(createApp())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      select: {
        id: true,
        username: true,
        name: true,
        timezone: true,
        onboardingState: true,
        onboardingCompletedAt: true,
        gettingStartedState: true,
      },
    })
    expect(response.body).toEqual({
      id: 'user-123',
      username: 'person@example.com',
      name: 'Person',
      timezone: 'UTC',
      onboardingState: {},
      onboardingCompletedAt: null,
      gettingStartedState: {},
      onboardingRequired: false,
    })
  })

  it('marks a newly created account as requiring onboarding', async () => {
    prisma.user.findUnique.mockResolvedValue(null)
    prisma.user.create.mockImplementation(async ({ data }) => ({
      id: 'new-user',
      username: data.username,
      name: data.name,
      timezone: 'UTC',
      onboardingState: data.onboardingState,
      onboardingCompletedAt: null,
      gettingStartedState: null,
    }))

    const response = await request(createApp())
      .post('/api/auth/signup')
      .send({ name: 'New Person', email: 'new@example.com', password: 'strong-password' })
      .expect(200)

    expect(response.body).toMatchObject({
      id: 'new-user',
      username: 'new@example.com',
      onboardingRequired: true,
    })
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        onboardingState: expect.objectContaining({ startedAt: expect.any(String) }),
      }),
    })
  })

  it('persists onboarding state for the authenticated user', async () => {
    const { signToken } = await import('../lib/auth.js')
    const token = await signToken({
      userId: 'user-123',
      username: 'person@example.com',
      name: 'Person',
    })
    prisma.user.findUnique.mockResolvedValue({
      onboardingState: { priorities: ['work'] },
      onboardingCompletedAt: null,
    })
    prisma.user.update.mockResolvedValue({
      id: 'user-123',
      username: 'person@example.com',
      name: 'Person',
      timezone: 'Asia/Kolkata',
      onboardingState: { priorities: ['work'], connectCalendar: true, completed: true },
      onboardingCompletedAt: new Date('2026-08-16T00:00:00.000Z'),
      gettingStartedState: {},
    })

    const response = await request(createApp())
      .patch('/api/v1/users/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({
        connectCalendar: true,
        timezone: 'Asia/Kolkata',
        termsAccepted: true,
        termsVersion: '2026-08-16',
        completed: true,
      })
      .expect(200)

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-123' },
      data: expect.objectContaining({
        timezone: 'Asia/Kolkata',
        onboardingState: expect.objectContaining({
          priorities: ['work'],
          connectCalendar: true,
          termsVersion: '2026-08-16',
          termsAcceptedAt: expect.any(String),
          completed: true,
        }),
        onboardingCompletedAt: expect.any(Date),
      }),
    }))
    expect(response.body.onboardingState.completed).toBe(true)
  })

  it('keeps auth public under the /api/v1 compatibility prefix', async () => {
    prisma.user.findUnique.mockResolvedValue(null)

    await request(createApp())
      .post('/api/v1/auth/login')
      .send({ username: 'person@example.com', password: 'wrong-password' })
      .expect(401)

    expect(prisma.user.findUnique).toHaveBeenCalled()
  })

  it('requires authentication to register a device token', async () => {
    await request(createApp())
      .post('/api/devices/register')
      .send({ fcmToken: 'token' })
      .expect(401)
  })
})
