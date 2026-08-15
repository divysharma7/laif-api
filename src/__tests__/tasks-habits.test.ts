import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const prisma = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  taskReminder: { deleteMany: vi.fn() },
  taskComment: { create: vi.fn() },
  habitCompletion: { upsert: vi.fn() },
  notificationSchedule: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  taskTombstone: { upsert: vi.fn() },
  list: { findFirst: vi.fn() },
  workflow: { findFirst: vi.fn() },
  workflowColumn: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ getPrisma: () => prisma }))

const { createApp } = await import('../app.js')
const { signToken } = await import('../lib/auth.js')

let authorization: string

function taskRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    userId: 'owner-123',
    title: 'Owned task',
    status: 'todo',
    comments: [],
    reminders: [],
    completions: [],
    activities: [],
    ...overrides,
  }
}

describe('task and habit API ownership', () => {
  beforeAll(async () => {
    const token = await signToken({
      userId: 'owner-123',
      username: 'owner@example.com',
      name: 'Owner',
    })
    authorization = `Bearer ${token}`
  })

  beforeEach(() => {
    vi.resetAllMocks()
    prisma.$transaction.mockImplementation(async (operation: (client: typeof prisma) => unknown) => operation(prisma))
  })

  it('scopes task listing to the authenticated user', async () => {
    prisma.task.findMany.mockResolvedValue([taskRecord()])

    const response = await request(createApp())
      .get('/api/tasks')
      .set('Authorization', authorization)
      .expect(200)

    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner-123' },
      orderBy: { createdAt: 'desc' },
    }))
    expect(response.body[0]).toMatchObject({
      _id: 'task-1',
      userId: 'owner-123',
      title: 'Owned task',
      type: 'task',
    })
    expect(response.body[0]).not.toHaveProperty('id')
  })

  it('injects authenticated ownership and a nested activity when creating a task', async () => {
    prisma.task.create.mockResolvedValue(taskRecord({
      id: 'task-2',
      title: 'Ship migration',
      activities: [{
        id: 'activity-1',
        taskId: 'task-2',
        action: 'created',
        detail: 'Task created',
        timestamp: new Date('2026-07-29T00:00:00.000Z'),
      }],
    }))

    const response = await request(createApp())
      .post('/api/tasks')
      .set('Authorization', authorization)
      .send({ title: 'Ship migration', status: 'todo' })
      .expect(201)

    expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: 'Ship migration',
        status: 'todo',
        userId: 'owner-123',
        activities: { create: expect.objectContaining({ action: 'created' }) },
      }),
    }))
    expect(response.body).toMatchObject({
      _id: 'task-2',
      userId: 'owner-123',
      title: 'Ship migration',
      type: 'task',
      activities: [{ _id: 'activity-1', action: 'created' }],
    })
  })

  it('replays a desktop capture idempotently for the same authenticated user', async () => {
    const existing = taskRecord({
      id: 'task-desktop',
      title: 'Desktop capture',
      clientCommandId: 'desktop-command-1',
    })
    prisma.task.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing)
    prisma.task.create.mockResolvedValue(existing)

    await request(createApp())
      .post('/api/tasks')
      .set('Authorization', authorization)
      .send({
        title: 'Desktop capture',
        status: 'backlog',
        clientCommandId: 'desktop-command-1',
      })
      .expect(201)

    const replay = await request(createApp())
      .post('/api/tasks')
      .set('Authorization', authorization)
      .send({
        title: 'Desktop capture',
        status: 'backlog',
        clientCommandId: 'desktop-command-1',
      })
      .expect(200)

    expect(prisma.task.create).toHaveBeenCalledTimes(1)
    expect(prisma.task.findFirst).toHaveBeenLastCalledWith({
      where: {
        userId: 'owner-123',
        clientCommandId: 'desktop-command-1',
      },
      include: expect.any(Object),
    })
    expect(replay.body).toMatchObject({
      _id: 'task-desktop',
      title: 'Desktop capture',
    })
    expect(replay.body).not.toHaveProperty('clientCommandId')
  })

  it('returns the winning task when two desktop retries race', async () => {
    const existing = taskRecord({
      id: 'task-race-winner',
      clientCommandId: 'desktop-race-1',
    })
    prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    )
    prisma.task.findFirst.mockResolvedValue(existing)

    const response = await request(createApp())
      .post('/api/tasks')
      .set('Authorization', authorization)
      .send({
        title: 'Racing capture',
        clientCommandId: 'desktop-race-1',
      })
      .expect(200)

    expect(response.body._id).toBe('task-race-winner')
    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'owner-123',
        clientCommandId: 'desktop-race-1',
      },
      include: expect.any(Object),
    })
  })

  it('translates public task and reminder enums at the Prisma boundary', async () => {
    prisma.task.create.mockResolvedValue(taskRecord({
      status: 'in_progress',
      reminders: [{
        id: 'reminder-1',
        taskId: 'task-1',
        type: 'before_start',
        offsetMinutes: 15,
      }],
    }))

    const response = await request(createApp())
      .post('/api/tasks')
      .set('Authorization', authorization)
      .send({
        title: 'Mapped enums',
        status: 'in-progress',
        reminders: [{
          id: 'reminder-1',
          type: 'before-start',
          offsetMinutes: 15,
        }],
      })
      .expect(201)

    expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'in_progress',
        reminders: {
          create: [expect.objectContaining({ type: 'before_start' })],
        },
      }),
    }))
    expect(response.body).toMatchObject({
      status: 'in-progress',
      reminders: [expect.objectContaining({ type: 'before-start' })],
    })
  })

  it('rejects invalid task input before writing', async () => {
    const response = await request(createApp())
      .post('/api/tasks')
      .set('Authorization', authorization)
      .send({ title: '' })
      .expect(422)

    expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it('does not allow a task to reference another user’s list', async () => {
    prisma.list.findFirst.mockResolvedValue(null)

    const response = await request(createApp())
      .post('/api/tasks')
      .set('Authorization', authorization)
      .send({ title: 'Cross-tenant task', listId: 'other-user-list' })
      .expect(404)

    expect(prisma.list.findFirst).toHaveBeenCalledWith({
      where: { id: 'other-user-list', ownerId: 'owner-123' },
      select: { id: true },
    })
    expect(prisma.task.create).not.toHaveBeenCalled()
    expect(response.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'List not found: other-user-list',
    })
  })

  it('uses both task id and owner id for lookup and hides non-owned tasks', async () => {
    prisma.task.findFirst.mockResolvedValue(null)

    const response = await request(createApp())
      .get('/api/tasks/not-owned')
      .set('Authorization', authorization)
      .expect(404)

    expect(prisma.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'not-owned', userId: 'owner-123' },
    }))
    expect(response.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Task not found: not-owned',
    })
  })

  it('scopes task updates to the authenticated user', async () => {
    prisma.task.findFirst.mockResolvedValue({ id: 'task-3' })
    prisma.task.update.mockResolvedValue(taskRecord({ id: 'task-3', title: 'Updated task' }))

    await request(createApp())
      .patch('/api/tasks/task-3')
      .set('Authorization', authorization)
      .send({ title: 'Updated task' })
      .expect(200)

    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: { id: 'task-3', userId: 'owner-123' },
      select: { id: true, version: true },
    })
    expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-3' },
      data: { title: 'Updated task', version: { increment: 1 } },
    }))
  })

  it('rejects a stale task update before writing', async () => {
    prisma.task.findFirst.mockResolvedValue({ id: 'task-3', version: 4 })

    const response = await request(createApp())
      .put('/api/tasks/task-3')
      .set('Authorization', authorization)
      .send({ title: 'Stale update', expectedVersion: 3 })
      .expect(409)

    expect(response.body.error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 4 },
    })
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it('rejects malformed reminder times before writing', async () => {
    await request(createApp())
      .post('/api/tasks')
      .set('Authorization', authorization)
      .send({
        title: 'Invalid reminder',
        reminders: [{ id: 'reminder-1', type: 'on-day-at', timeOfDay: '99:75' }],
      })
      .expect(422)

    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it('scopes task deletion and subtask cleanup to the authenticated user', async () => {
    prisma.task.findFirst.mockResolvedValue({ id: 'task-3' })
    prisma.task.deleteMany.mockResolvedValue({ count: 2 })
    prisma.task.delete.mockResolvedValue(taskRecord({ id: 'task-3' }))
    prisma.task.findMany.mockResolvedValue([{ id: 'task-3' }, { id: 'child-1' }])
    prisma.taskTombstone.upsert.mockResolvedValue({})

    const response = await request(createApp())
      .delete('/api/tasks/task-3')
      .set('Authorization', authorization)
      .expect(200)

    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: { id: 'task-3', userId: 'owner-123' },
      select: { id: true },
    })
    expect(prisma.task.deleteMany).toHaveBeenCalledWith({
      where: { parentId: 'task-3', userId: 'owner-123' },
    })
    expect(prisma.taskTombstone.upsert).toHaveBeenCalledTimes(2)
    expect(prisma.taskTombstone.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskId: 'task-3' },
      update: expect.objectContaining({ userId: 'owner-123', deletedAt: expect.any(Date) }),
      create: expect.objectContaining({ taskId: 'task-3', userId: 'owner-123', deletedAt: expect.any(Date) }),
    }))
    expect(response.body).toEqual({ success: true })
  })

  it('scopes habit listing to owned task-backed habits', async () => {
    prisma.task.findMany.mockResolvedValue([
      taskRecord({ id: 'habit-1', title: 'Read', isHabit: true }),
    ])

    const response = await request(createApp())
      .get('/api/habits')
      .set('Authorization', authorization)
      .expect(200)

    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner-123', isHabit: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    }))
    expect(response.body[0]).toMatchObject({
      _id: 'habit-1',
      userId: 'owner-123',
      isHabit: true,
    })
  })

  it('creates a habit as an owned task-backed record', async () => {
    prisma.task.create.mockResolvedValue(taskRecord({
      id: 'habit-2',
      title: 'Exercise',
      isHabit: true,
    }))

    const response = await request(createApp())
      .post('/api/habits')
      .set('Authorization', authorization)
      .send({ name: 'Exercise', frequency: 'daily', icon: 'Dumbbell' })
      .expect(201)

    expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'owner-123',
        title: 'Exercise',
        isHabit: true,
        habitFrequency: { type: 'daily' },
      }),
    }))
    expect(response.body).toMatchObject({
      _id: 'habit-2',
      userId: 'owner-123',
      isHabit: true,
    })
  })

  it('maps habit updates to task-backed fields after checking ownership', async () => {
    prisma.task.findFirst.mockResolvedValue({ id: 'habit-3' })
    prisma.task.update.mockResolvedValue(taskRecord({
      id: 'habit-3',
      title: 'Read daily',
      isHabit: true,
      habitIcon: 'Book',
    }))

    await request(createApp())
      .put('/api/habits/habit-3')
      .set('Authorization', authorization)
      .send({ name: 'Read daily', icon: 'Book', archived: true })
      .expect(200)

    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: { id: 'habit-3', userId: 'owner-123', isHabit: true },
      select: { id: true },
    })
    expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'habit-3' },
      data: { title: 'Read daily', habitIcon: 'Book', status: 'dropped' },
    }))
  })

  it('hides a habit that is not owned by the authenticated user', async () => {
    prisma.task.findFirst.mockResolvedValue(null)

    const response = await request(createApp())
      .get('/api/habits/not-owned')
      .set('Authorization', authorization)
      .expect(404)

    expect(prisma.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'not-owned', userId: 'owner-123', isHabit: true },
    }))
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('scopes habit deletion to an owned task-backed habit', async () => {
    prisma.task.deleteMany.mockResolvedValue({ count: 1 })

    const response = await request(createApp())
      .delete('/api/habits/habit-4')
      .set('Authorization', authorization)
      .expect(200)

    expect(prisma.task.deleteMany).toHaveBeenCalledWith({
      where: { id: 'habit-4', userId: 'owner-123', isHabit: true },
    })
    expect(response.body).toEqual({ success: true })
  })

  it('does not query for a habit when check-in input is invalid', async () => {
    const response = await request(createApp())
      .post('/api/habits/habit-4/checkin')
      .set('Authorization', authorization)
      .send({ date: '29-07-2026', status: 'achieved' })
      .expect(422)

    expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(prisma.task.findFirst).not.toHaveBeenCalled()
  })

  it('upserts a dated completion only after checking habit ownership', async () => {
    const completion = {
      id: 'completion-1',
      taskId: 'habit-4',
      date: new Date('2026-07-29T00:00:00.000Z'),
      status: 'achieved',
      value: null,
      reason: null,
      loggedAt: new Date('2026-07-29T01:00:00.000Z'),
    }
    prisma.task.findFirst.mockResolvedValue({ id: 'habit-4' })
    prisma.habitCompletion.upsert.mockResolvedValue(completion)
    prisma.task.findUniqueOrThrow.mockResolvedValue(taskRecord({
      id: 'habit-4',
      isHabit: true,
      completions: [completion],
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    }))
    prisma.task.update.mockResolvedValue(taskRecord({
      id: 'habit-4',
      isHabit: true,
      completions: [completion],
      streakCurrent: 1,
      streakBest: 1,
    }))

    const response = await request(createApp())
      .post('/api/habits/habit-4/checkin')
      .set('Authorization', authorization)
      .send({ date: '2026-07-29', status: 'achieved' })
      .expect(200)

    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: { id: 'habit-4', userId: 'owner-123', isHabit: true },
      select: { id: true },
    })
    expect(prisma.habitCompletion.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        taskId_date: {
          taskId: 'habit-4',
          date: new Date('2026-07-29T00:00:00.000Z'),
        },
      },
      create: expect.objectContaining({
        taskId: 'habit-4',
        status: 'achieved',
        value: null,
        reason: null,
      }),
    }))
    expect(response.body.completions).toEqual([
      expect.objectContaining({ _id: 'completion-1', date: '2026-07-29', status: 'achieved' }),
    ])
  })
})
