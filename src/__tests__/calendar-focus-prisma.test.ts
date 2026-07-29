import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const prisma = vi.hoisted(() => {
  const client = {
    event: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    eventComment: { create: vi.fn() },
    task: { findMany: vi.fn(), findFirst: vi.fn() },
    reminder: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    reminderComment: { create: vi.fn() },
    externalCalendarEvent: { findMany: vi.fn(), findFirst: vi.fn() },
    calendarAccount: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    calendar: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    focusSession: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    pomodoroSession: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    oAuthState: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  }
  return client
})

const googleAuth = vi.hoisted(() => ({
  generateAuthUrl: vi.fn((_options: { state: string }) => 'https://accounts.google.test/oauth'),
  getToken: vi.fn(),
  setCredentials: vi.fn(),
}))

const googleUserInfo = vi.hoisted(() => ({
  get: vi.fn(),
}))

const googleSync = vi.hoisted(() => ({
  run: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  getPrisma: () => prisma,
}))

vi.mock('../services/googleCalendarSync.js', () => ({
  syncGoogleAccount: googleSync.run,
}))

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        generateAuthUrl = googleAuth.generateAuthUrl
        getToken = googleAuth.getToken
        setCredentials = googleAuth.setCredentials
      },
    },
    oauth2: vi.fn(() => ({
      userinfo: { get: googleUserInfo.get },
    })),
  },
}))

process.env.GOOGLE_CLIENT_ID = 'test-google-client'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret'
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3001/api/integrations/google/callback'
process.env.FRONTEND_URL = 'http://localhost:3000'
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

const { createApp } = await import('../app.js')
const { signToken } = await import('../lib/auth.js')

let authorization: string

describe('calendar and focus Prisma routes', () => {
  beforeAll(async () => {
    authorization = `Bearer ${await signToken({
      userId: 'owner-123',
      username: 'owner@example.com',
      name: 'Owner',
    })}`
  })

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.oAuthState.create.mockResolvedValue({})
    prisma.oAuthState.updateMany.mockReset()
    prisma.oAuthState.updateMany.mockResolvedValue({ count: 1 })
    googleAuth.getToken.mockReset()
    googleUserInfo.get.mockReset()
    googleUserInfo.get.mockResolvedValue({
      data: {
        id: 'google-account-123',
        email: 'owner@gmail.com',
        name: 'Owner Google',
        picture: 'https://images.example.test/owner.png',
      },
    })
    googleSync.run.mockResolvedValue({
      state: 'healthy',
      alreadyRunning: false,
      calendarsDiscovered: 2,
      calendarsSynced: 2,
      eventsUpserted: 4,
      eventsDeleted: 1,
      failures: [],
    })
    prisma.calendarAccount.findFirst.mockResolvedValue(null)
    prisma.$transaction.mockImplementation(async (callback: (client: typeof prisma) => unknown) =>
      callback(prisma))
  })

  it('scopes unified calendar reads and preserves public resource IDs', async () => {
    prisma.event.findMany.mockResolvedValue([{
      id: 'event-1',
      userId: 'owner-123',
      title: 'Meeting',
      comments: [],
    }])
    prisma.task.findMany.mockResolvedValue([{
      id: 'task-1',
      userId: 'owner-123',
      title: 'Plan',
      status: 'in_progress',
      comments: [],
      reminders: [{ id: 'task-reminder-1', type: 'before_start' }],
      completions: [],
      activities: [],
    }])
    prisma.reminder.findMany.mockResolvedValue([{
      id: 'reminder-1',
      userId: 'owner-123',
      title: 'Call',
      comments: [],
    }])

    const response = await request(createApp())
      .get('/api/calendar')
      .set('Authorization', authorization)
      .expect(200)

    expect(prisma.event.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner-123' },
    }))
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner-123', dueDate: { not: null } },
    }))
    expect(prisma.reminder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner-123' },
    }))
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ _id: 'event-1', itemType: 'event' }),
      expect.objectContaining({
        _id: 'task-1',
        status: 'in-progress',
        itemType: 'task',
        reminders: [
          expect.objectContaining({
            id: 'task-reminder-1',
            _id: 'task-reminder-1',
            type: 'before-start',
          }),
        ],
      }),
      expect.objectContaining({ _id: 'reminder-1', itemType: 'reminder' }),
    ]))
    expect(response.body.every((item: Record<string, unknown>) => !('id' in item))).toBe(true)
  })

  it('returns the published Agenda contract with mixed owned item types', async () => {
    prisma.user.findUnique.mockResolvedValue({
      timezone: 'Asia/Calcutta',
      googleCalendarConnected: true,
    })
    prisma.task.findMany
      .mockResolvedValueOnce([
        {
          id: 'task-1',
          userId: 'owner-123',
          title: 'Write API contract',
          scheduledStart: new Date('2026-07-29T04:30:00.000Z'),
          scheduledEnd: new Date('2026-07-29T05:00:00.000Z'),
          estimatedEffort: 0.5,
          dueDate: new Date('2026-07-29T00:00:00.000Z'),
          priority: 'high',
          status: 'todo',
          color: '#6366f1',
          isHabit: false,
          completions: [],
        },
        {
          id: 'habit-1',
          userId: 'owner-123',
          title: 'Morning meditation',
          scheduledStart: new Date('2026-07-29T01:30:00.000Z'),
          scheduledEnd: new Date('2026-07-29T01:45:00.000Z'),
          estimatedEffort: 0.25,
          dueDate: null,
          priority: 'medium',
          status: 'todo',
          color: '#f59e0b',
          isHabit: true,
          completions: [{ status: 'achieved' }],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'task-unscheduled',
          userId: 'owner-123',
          title: 'Review deployment',
          priority: 'medium',
          estimatedEffort: 1,
          dueDate: new Date('2026-07-30T00:00:00.000Z'),
          createdAt: new Date('2026-07-28T12:00:00.000Z'),
        },
      ])
    prisma.externalCalendarEvent.findMany.mockResolvedValue([
      {
        id: 'external-1',
        userId: 'owner-123',
        source: 'google',
        externalId: 'google-event-1',
        title: 'Design review',
        start: new Date('2026-07-29T08:30:00.000Z'),
        end: new Date('2026-07-29T09:30:00.000Z'),
        allDay: false,
        calendarId: 'work',
        accountId: 'account-1',
        calendarRecordId: 'calendar-1',
        calendar: {
          name: 'Work',
          providerColor: '#4285f4',
          colorOverride: null,
          affectsAvailability: true,
        },
        lastSyncedAt: new Date('2026-07-29T03:00:00.000Z'),
      },
    ])
    prisma.calendarAccount.findFirst.mockResolvedValue({
      status: 'healthy',
      reconnectRequired: false,
      lastSuccessfulSyncAt: new Date('2026-07-29T03:00:00.000Z'),
    })
    prisma.focusSession.findMany.mockResolvedValue([
      {
        id: 'focus-1',
        userId: 'owner-123',
        taskId: 'task-1',
        taskTitleSnapshot: 'Write API contract',
        startedAt: new Date('2026-07-29T10:30:00.000Z'),
        endedAt: new Date('2026-07-29T11:30:00.000Z'),
        actualDurationMin: 60,
        status: 'completed',
      },
    ])

    const response = await request(createApp())
      .get('/api/calendar/agenda?date=2026-07-29&timeZone=Asia%2FCalcutta')
      .set('Authorization', authorization)
      .expect(200)

    expect(response.body).toMatchObject({
      date: '2026-07-29',
      timeZone: 'Asia/Calcutta',
      sync: {
        state: 'healthy',
        lastSuccessfulAt: '2026-07-29T03:00:00.000Z',
      },
      items: [
        expect.objectContaining({
          id: 'habit-1',
          kind: 'habit',
          completed: true,
          availability: 'free',
        }),
        expect.objectContaining({
          id: 'task-1',
          kind: 'task',
          source: { type: 'lifeos' },
          actions: ['complete', 'focus', 'reschedule'],
        }),
        expect.objectContaining({
          id: 'external-1',
          kind: 'external_event',
          source: expect.objectContaining({
            type: 'google',
            accountId: 'account-1',
            calendarId: 'work',
            displayName: 'Work',
          }),
          color: '#4285f4',
          availability: 'busy',
        }),
        expect.objectContaining({
          id: 'focus-1',
          kind: 'focus_session',
          completed: true,
        }),
      ],
      unscheduledPriorities: [
        {
          id: 'task-unscheduled',
          title: 'Review deployment',
          priority: 'medium',
          estimatedMinutes: 60,
          dueDate: '2026-07-30',
        },
      ],
    })
    expect(response.body.generatedAt).toEqual(expect.any(String))

    const scheduledTaskQuery = prisma.task.findMany.mock.calls[0][0]
    expect(scheduledTaskQuery.where).toEqual(expect.objectContaining({
      userId: 'owner-123',
      scheduledStart: {
        not: null,
        lt: new Date('2026-07-29T18:30:00.000Z'),
      },
    }))
    expect(prisma.externalCalendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'owner-123',
          calendar: expect.objectContaining({ isActiveInAgenda: true }),
          start: { lt: new Date('2026-07-29T18:30:00.000Z') },
          end: { gt: new Date('2026-07-28T18:30:00.000Z') },
        }),
        include: {
          calendar: {
            select: {
              name: true,
              providerColor: true,
              colorOverride: true,
              affectsAvailability: true,
            },
          },
        },
      }),
    )
    expect(prisma.focusSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'owner-123',
          status: 'completed',
        }),
      }),
    )
  })

  it('uses local-day bounds across a daylight-saving transition', async () => {
    prisma.user.findUnique.mockResolvedValue({
      timezone: 'America/New_York',
      googleCalendarConnected: false,
    })
    prisma.task.findMany.mockResolvedValue([])
    prisma.externalCalendarEvent.findMany.mockResolvedValue([])
    prisma.calendarAccount.findFirst.mockResolvedValue(null)
    prisma.focusSession.findMany.mockResolvedValue([])

    const response = await request(createApp())
      .get('/api/calendar/agenda?date=2026-03-08&timeZone=America%2FNew_York')
      .set('Authorization', authorization)
      .expect(200)

    expect(response.body.sync).toEqual({
      state: 'not_connected',
      lastSuccessfulAt: null,
    })
    expect(prisma.externalCalendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'owner-123',
          start: { lt: new Date('2026-03-09T04:00:00.000Z') },
          end: { gt: new Date('2026-03-08T05:00:00.000Z') },
        }),
      }),
    )
  })

  it('rejects an invalid Agenda date or time zone before reading user data', async () => {
    const invalidDate = await request(createApp())
      .get('/api/calendar/agenda?date=2026-02-31&timeZone=UTC')
      .set('Authorization', authorization)
      .expect(400)
    const invalidZone = await request(createApp())
      .get('/api/calendar/agenda?date=2026-07-29&timeZone=Not%2FAZone')
      .set('Authorization', authorization)
      .expect(400)

    expect(invalidDate.body.error).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(invalidZone.body.error).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.task.findMany).not.toHaveBeenCalled()
  })

  it('scopes event updates to the authenticated user', async () => {
    prisma.event.findFirst.mockResolvedValue({
      id: 'event-1',
      startDate: new Date('2026-07-29T10:00:00.000Z'),
      endDate: new Date('2026-07-29T11:00:00.000Z'),
    })
    prisma.event.update.mockResolvedValue({})
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      userId: 'owner-123',
      title: 'Updated',
      comments: [],
    })

    const response = await request(createApp())
      .put('/api/events/event-1')
      .set('Authorization', authorization)
      .send({ title: 'Updated' })
      .expect(200)

    expect(prisma.event.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'event-1', userId: 'owner-123' },
    }))
    expect(response.body).toMatchObject({ _id: 'event-1', title: 'Updated' })
  })

  it('hides a non-owned reminder during mutation', async () => {
    prisma.reminder.updateMany.mockResolvedValue({ count: 0 })

    const response = await request(createApp())
      .put('/api/reminders/not-owned')
      .set('Authorization', authorization)
      .send({ title: 'No access' })
      .expect(404)

    expect(prisma.reminder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'not-owned', userId: 'owner-123' },
    }))
    expect(prisma.reminder.findUnique).not.toHaveBeenCalled()
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('creates a focus session atomically and validates task ownership', async () => {
    prisma.focusSession.updateMany.mockResolvedValue({ count: 1 })
    prisma.task.findFirst.mockResolvedValue({ title: 'Owned task' })
    prisma.focusSession.create.mockResolvedValue({
      id: 'focus-1',
      userId: 'owner-123',
      taskId: 'task-1',
      taskTitleSnapshot: 'Owned task',
      status: 'active',
    })

    const response = await request(createApp())
      .post('/api/focus/sessions')
      .set('Authorization', authorization)
      .send({ taskId: 'task-1', plannedDurationMin: 25 })
      .expect(201)

    expect(prisma.focusSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner-123', status: 'active' },
    }))
    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: { id: 'task-1', userId: 'owner-123' },
      select: { title: true },
    })
    expect(response.body).toMatchObject({
      _id: 'focus-1',
      taskTitleSnapshot: 'Owned task',
    })
  })

  it('scopes Pomodoro updates to the authenticated user', async () => {
    prisma.pomodoroSession.updateMany.mockResolvedValue({ count: 1 })
    prisma.pomodoroSession.findUnique.mockResolvedValue({
      id: 'pomodoro-1',
      userId: 'owner-123',
      completed: true,
    })

    const response = await request(createApp())
      .patch('/api/pomodoro/pomodoro-1')
      .set('Authorization', authorization)
      .send({ completed: true })
      .expect(200)

    expect(prisma.pomodoroSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pomodoro-1', userId: 'owner-123' },
    }))
    expect(response.body).toMatchObject({ _id: 'pomodoro-1', completed: true })
  })

  it('uses a signed expiring OAuth state instead of exposing the raw user ID', async () => {
    const response = await request(createApp())
      .get('/api/integrations/google/auth')
      .set('Authorization', authorization)
      .expect(200)

    const options = googleAuth.generateAuthUrl.mock.calls[0][0]
    expect(options.state).not.toBe('owner-123')
    expect(options.state.split('.')).toHaveLength(3)
    expect(options).toMatchObject({
      access_type: 'offline',
      include_granted_scopes: true,
      prompt: 'consent',
      scope: [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      ],
    })
    expect(response.body).toEqual({ url: 'https://accounts.google.test/oauth' })
  })

  it('rejects an unsigned OAuth callback state before exchanging the code', async () => {
    const response = await request(createApp())
      .get('/api/integrations/google/callback?code=test-code&state=owner-123')
      .set('Authorization', authorization)
      .expect(400)

    expect(response.body).toEqual({ error: 'Invalid or expired OAuth state' })
    expect(googleAuth.getToken).not.toHaveBeenCalled()
  })

  it('consumes OAuth state once and rejects a replay before exchanging the code', async () => {
    await request(createApp())
      .get('/api/integrations/google/auth')
      .set('Authorization', authorization)
      .expect(200)

    const state = googleAuth.generateAuthUrl.mock.calls[0][0].state
    googleAuth.getToken.mockResolvedValue({
      tokens: { access_token: 'access-token', refresh_token: 'refresh-token' },
    })
    prisma.calendarAccount.upsert.mockResolvedValue({ id: 'account-1' })
    prisma.oAuthState.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    await request(createApp())
      .get(`/api/integrations/google/callback?code=first-code&state=${encodeURIComponent(state)}`)
      .set('Authorization', authorization)
      .expect(302)

    await request(createApp())
      .get(`/api/integrations/google/callback?code=replayed-code&state=${encodeURIComponent(state)}`)
      .set('Authorization', authorization)
      .expect(400)

    expect(googleAuth.getToken).toHaveBeenCalledTimes(1)
  })

  it('encrypts Google tokens and preserves the refresh token when Google omits a new one', async () => {
    await request(createApp())
      .get('/api/integrations/google/auth')
      .set('Authorization', authorization)
      .expect(200)

    const state = googleAuth.generateAuthUrl.mock.calls[0][0].state
    googleAuth.getToken.mockResolvedValue({
      tokens: { access_token: 'new-access-token' },
    })
    prisma.calendarAccount.upsert.mockResolvedValue({ id: 'account-1' })

    await request(createApp())
      .get(`/api/integrations/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
      .set('Authorization', authorization)
      .expect(302)

    const upsert = prisma.calendarAccount.upsert.mock.calls[0][0]
    expect(upsert.where).toEqual({
      userId_provider_providerAccountId: {
        userId: 'owner-123',
        provider: 'google',
        providerAccountId: 'google-account-123',
      },
    })
    const updateData = upsert.update
    expect(updateData.googleAccessToken).not.toBe('new-access-token')
    expect(updateData.googleAccessToken).toMatch(/^v1:/)
    expect(updateData).not.toHaveProperty('googleRefreshToken')
    expect(updateData).toMatchObject({
      email: 'owner@gmail.com',
      displayName: 'Owner Google',
      avatarUrl: 'https://images.example.test/owner.png',
      status: 'syncing',
      reconnectRequired: false,
    })
    expect(googleSync.run).toHaveBeenCalledWith('owner-123', 'account-1')
  })

  it('validates and consumes OAuth state when the user cancels consent', async () => {
    await request(createApp())
      .get('/api/integrations/google/auth')
      .set('Authorization', authorization)
      .expect(200)

    const state = googleAuth.generateAuthUrl.mock.calls[0][0].state

    const response = await request(createApp())
      .get(`/api/integrations/google/callback?error=access_denied&state=${encodeURIComponent(state)}`)
      .set('Authorization', authorization)
      .expect(302)

    expect(response.headers.location)
      .toBe('http://localhost:3000/settings?tab=integrations&google=cancelled')
    expect(prisma.oAuthState.updateMany).toHaveBeenCalled()
    expect(googleAuth.getToken).not.toHaveBeenCalled()
  })

  it('lists connected Google accounts in the frontend account-card contract', async () => {
    prisma.calendarAccount.findMany.mockResolvedValue([
      {
        id: 'account-1',
        email: 'owner@gmail.com',
        displayName: 'Owner Google',
        avatarUrl: null,
        status: 'healthy',
        lastSuccessfulSyncAt: new Date('2026-07-29T05:30:00.000Z'),
        reconnectRequired: false,
        calendars: [
          {
            id: 'calendar-1',
            name: 'Primary',
            isActiveInAgenda: true,
          },
        ],
      },
    ])

    const response = await request(createApp())
      .get('/api/integrations/google/accounts')
      .set('Authorization', authorization)
      .expect(200)

    expect(prisma.calendarAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'owner-123',
          provider: 'google',
          disconnectedAt: null,
        },
      }),
    )
    expect(response.body).toEqual([
      {
        id: 'account-1',
        email: 'owner@gmail.com',
        displayName: 'Owner Google',
        status: 'healthy',
        lastSyncAt: '2026-07-29T05:30:00.000Z',
        calendars: [
          { id: 'calendar-1', name: 'Primary', selected: true },
        ],
      },
    ])
  })

  it('lists owned calendars in the frontend control contract', async () => {
    prisma.calendar.findMany.mockResolvedValue([
      {
        id: 'calendar-1',
        accountId: 'account-1',
        providerCalendarId: 'primary',
        name: 'Primary',
        providerColor: '#4285f4',
        colorOverride: null,
        readOnly: false,
        isActiveInAgenda: true,
        isVisibleInCalendar: true,
        isDefaultWriteCalendar: true,
        sortOrder: 0,
        account: {
          email: 'owner@gmail.com',
          displayName: 'Owner Google',
        },
      },
    ])

    const response = await request(createApp())
      .get('/api/integrations/google/calendars')
      .set('Authorization', authorization)
      .expect(200)

    expect(prisma.calendar.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'owner-123',
          hidden: false,
          account: {
            provider: 'google',
            disconnectedAt: null,
          },
        },
      }),
    )
    expect(response.body).toEqual([
      {
        id: 'calendar-1',
        accountId: 'account-1',
        providerCalendarId: 'primary',
        name: 'Primary',
        color: '#4285f4',
        accountEmail: 'owner@gmail.com',
        accountLabel: 'Owner Google',
        readOnly: false,
        group: 'active',
        visible: true,
        order: 0,
        isDefaultWrite: true,
      },
    ])
  })

  it('moves an owned calendar to Passive and clears busy behavior', async () => {
    prisma.calendar.findFirst.mockResolvedValue({
      id: 'calendar-1',
      userId: 'owner-123',
      readOnly: false,
      isActiveInAgenda: true,
      isVisibleInCalendar: true,
      account: { disconnectedAt: null },
    })
    prisma.calendar.update.mockResolvedValue({
      id: 'calendar-1',
      accountId: 'account-1',
      providerCalendarId: 'primary',
      name: 'Primary',
      providerColor: '#4285f4',
      colorOverride: null,
      readOnly: false,
      isActiveInAgenda: false,
      isVisibleInCalendar: true,
      isDefaultWriteCalendar: false,
      sortOrder: 0,
      account: {
        email: 'owner@gmail.com',
        displayName: 'Owner Google',
      },
    })

    const response = await request(createApp())
      .patch('/api/integrations/google/calendars/calendar-1')
      .set('Authorization', authorization)
      .send({ group: 'passive' })
      .expect(200)

    expect(prisma.calendar.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'calendar-1', userId: 'owner-123', hidden: false },
      }),
    )
    expect(prisma.calendar.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'calendar-1' },
        data: {
          isActiveInAgenda: false,
          affectsAvailability: false,
        },
      }),
    )
    expect(response.body).toMatchObject({ group: 'passive', visible: true })
  })

  it('sets one owned writable default calendar in a transaction', async () => {
    prisma.calendar.findFirst.mockResolvedValue({
      id: 'calendar-2',
      userId: 'owner-123',
      readOnly: false,
      isActiveInAgenda: true,
      isVisibleInCalendar: true,
      account: { disconnectedAt: null },
    })
    prisma.calendar.updateMany.mockResolvedValue({ count: 1 })
    prisma.calendar.update.mockResolvedValue({
      id: 'calendar-2',
      accountId: 'account-1',
      providerCalendarId: 'work',
      name: 'Work',
      providerColor: '#da1e28',
      colorOverride: null,
      readOnly: false,
      isActiveInAgenda: true,
      isVisibleInCalendar: true,
      isDefaultWriteCalendar: true,
      sortOrder: 1,
      account: {
        email: 'owner@gmail.com',
        displayName: 'Owner Google',
      },
    })

    const response = await request(createApp())
      .patch('/api/integrations/google/calendars/calendar-2')
      .set('Authorization', authorization)
      .send({ isDefaultWrite: true })
      .expect(200)

    expect(prisma.calendar.updateMany).toHaveBeenCalledWith({
      where: { userId: 'owner-123', isDefaultWriteCalendar: true },
      data: { isDefaultWriteCalendar: false },
    })
    expect(response.body).toMatchObject({
      id: 'calendar-2',
      isDefaultWrite: true,
    })
  })

  it('hides a non-owned calendar during inventory mutation', async () => {
    prisma.calendar.findFirst.mockResolvedValue(null)

    const response = await request(createApp())
      .patch('/api/integrations/google/calendars/not-owned')
      .set('Authorization', authorization)
      .send({ group: 'passive' })
      .expect(404)

    expect(prisma.calendar.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'not-owned',
          userId: 'owner-123',
          hidden: false,
        },
      }),
    )
    expect(prisma.calendar.update).not.toHaveBeenCalled()
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('does not allow an active calendar to be hidden directly', async () => {
    prisma.calendar.findFirst.mockResolvedValue({
      id: 'calendar-1',
      userId: 'owner-123',
      readOnly: false,
      isActiveInAgenda: true,
      isVisibleInCalendar: true,
      account: { disconnectedAt: null },
    })

    const response = await request(createApp())
      .patch('/api/integrations/google/calendars/calendar-1')
      .set('Authorization', authorization)
      .send({ visible: false })
      .expect(422)

    expect(prisma.calendar.update).not.toHaveBeenCalled()
    expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('triggers an owned account sync through the integration route', async () => {
    const response = await request(createApp())
      .post('/api/integrations/google/sync')
      .set('Authorization', authorization)
      .send({ accountId: 'account-1' })
      .expect(200)

    expect(googleSync.run).toHaveBeenCalledWith('owner-123', 'account-1')
    expect(response.body).toMatchObject({
      ok: true,
      state: 'healthy',
      calendarsSynced: 2,
      eventsUpserted: 4,
    })
  })
})
