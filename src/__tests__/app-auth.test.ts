import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import bcryptjs from 'bcryptjs'

const prisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
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
      username: 'person@example.com',
      name: 'Person',
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
      select: { username: true, name: true },
    })
    expect(response.body).toEqual({ username: 'person@example.com', name: 'Person' })
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
