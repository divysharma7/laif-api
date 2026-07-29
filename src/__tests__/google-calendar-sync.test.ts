import { beforeEach, describe, expect, it, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  calendarAccount: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  calendar: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  externalCalendarEvent: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}))

const googleAuth = vi.hoisted(() => ({
  setCredentials: vi.fn(),
  getAccessToken: vi.fn(),
}))

const googleCalendar = vi.hoisted(() => ({
  calendarList: vi.fn(),
  events: vi.fn(),
  eventsInsert: vi.fn(),
  eventsUpdate: vi.fn(),
  eventsDelete: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  getPrisma: () => prisma,
}))

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials = googleAuth.setCredentials
        getAccessToken = googleAuth.getAccessToken
      },
    },
    calendar: vi.fn(() => ({
      calendarList: { list: googleCalendar.calendarList },
      events: {
        list: googleCalendar.events,
        insert: googleCalendar.eventsInsert,
        update: googleCalendar.eventsUpdate,
        delete: googleCalendar.eventsDelete,
      },
    })),
  },
}))

process.env.GOOGLE_CLIENT_ID = 'test-google-client'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret'
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3001/api/integrations/google/callback'
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

const { encryptSecret } = await import('../lib/secretEncryption.js')
const { syncDueGoogleAccounts, syncGoogleAccount } =
  await import('../services/googleCalendarSync.js')
const { syncTaskToGoogle, unsyncTaskFromGoogle } =
  await import('../services/googleCalendarOutboundSync.js')

const encryptedAccess = encryptSecret(
  'stored-access-token',
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
)
const encryptedRefresh = encryptSecret(
  'stored-refresh-token',
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
)

function accountRecord() {
  return {
    id: 'account-1',
    userId: 'owner-123',
    googleAccessToken: encryptedAccess,
    googleRefreshToken: encryptedRefresh,
    tokenExpiresAt: new Date('2026-07-29T00:00:00.000Z'),
    disconnectedAt: null,
  }
}

function calendarRecord(providerCalendarId: string, syncToken: string | null = null) {
  return {
    id: `calendar-${providerCalendarId}`,
    userId: 'owner-123',
    accountId: 'account-1',
    providerCalendarId,
    syncToken,
    isPrimary: providerCalendarId === 'primary',
    readOnly: providerCalendarId !== 'primary',
  }
}

describe('Google Calendar inbound sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.calendarAccount.updateMany.mockResolvedValue({ count: 1 })
    prisma.calendarAccount.findFirst.mockResolvedValue(accountRecord())
    prisma.calendarAccount.update.mockResolvedValue({})
    prisma.calendar.findFirst.mockResolvedValue(null)
    prisma.calendar.updateMany.mockResolvedValue({ count: 0 })
    prisma.calendar.update.mockResolvedValue({})
    prisma.externalCalendarEvent.upsert.mockResolvedValue({})
    prisma.externalCalendarEvent.deleteMany.mockResolvedValue({ count: 1 })
    googleAuth.getAccessToken.mockResolvedValue({ token: 'stored-access-token' })

    googleCalendar.calendarList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'primary',
            summary: 'Primary',
            primary: true,
            selected: true,
            accessRole: 'owner',
            backgroundColor: '#4285f4',
            timeZone: 'Asia/Calcutta',
          },
          {
            id: 'holidays',
            summary: 'Holidays',
            selected: false,
            accessRole: 'reader',
            backgroundColor: '#f59e0b',
            timeZone: 'Asia/Calcutta',
          },
        ],
      },
    })
    prisma.calendar.upsert.mockImplementation(({ create }: { create: { providerCalendarId: string } }) =>
      Promise.resolve(calendarRecord(create.providerCalendarId)))
    googleCalendar.events.mockImplementation(({ calendarId }: { calendarId: string }) =>
      Promise.resolve({
        data: {
          items: calendarId === 'primary'
            ? [
                {
                  id: 'event-1',
                  status: 'confirmed',
                  summary: 'Design review',
                  start: { dateTime: '2026-07-29T09:00:00+05:30' },
                  end: { dateTime: '2026-07-29T10:00:00+05:30' },
                },
                {
                  id: 'event-cancelled',
                  status: 'cancelled',
                },
              ]
            : [],
          nextSyncToken: `next-${calendarId}`,
        },
      }))
  })

  it('discovers calendars, performs a bounded initial sync, and applies cancellations', async () => {
    const result = await syncGoogleAccount('owner-123', 'account-1')

    expect(result).toMatchObject({
      state: 'healthy',
      alreadyRunning: false,
      calendarsDiscovered: 2,
      calendarsSynced: 2,
      eventsUpserted: 1,
      eventsDeleted: 1,
    })
    expect(prisma.calendar.upsert).toHaveBeenCalledTimes(2)
    expect(googleCalendar.events).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'primary',
      singleEvents: true,
      showDeleted: true,
      timeMin: expect.any(String),
      timeMax: expect.any(String),
    }))
    expect(googleCalendar.events.mock.calls[0][0]).not.toHaveProperty('syncToken')
    expect(prisma.externalCalendarEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_calendarId_externalId: {
            accountId: 'account-1',
            calendarId: 'primary',
            externalId: 'event-1',
          },
        },
        create: expect.objectContaining({
          userId: 'owner-123',
          accountId: 'account-1',
          calendarRecordId: 'calendar-primary',
          title: 'Design review',
          allDay: false,
        }),
      }),
    )
    expect(prisma.externalCalendarEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner-123',
        accountId: 'account-1',
        calendarId: 'primary',
        externalId: 'event-cancelled',
      },
    })
    expect(prisma.calendar.update).toHaveBeenCalledWith({
      where: { id: 'calendar-primary' },
      data: {
        syncToken: 'next-primary',
        lastSyncedAt: expect.any(Date),
      },
    })
    expect(prisma.calendarAccount.update).toHaveBeenLastCalledWith({
      where: { id: 'account-1' },
      data: expect.objectContaining({
        status: 'healthy',
        reconnectRequired: false,
        lastSuccessfulSyncAt: expect.any(Date),
      }),
    })
  })

  it('uses an existing sync token without an initial date window', async () => {
    prisma.calendar.upsert.mockImplementation(({ create }: { create: { providerCalendarId: string } }) =>
      Promise.resolve(calendarRecord(
        create.providerCalendarId,
        create.providerCalendarId === 'primary' ? 'previous-token' : null,
      )))

    await syncGoogleAccount('owner-123', 'account-1')

    const primaryRequest = googleCalendar.events.mock.calls
      .map(call => call[0])
      .find(request => request.calendarId === 'primary')
    expect(primaryRequest).toMatchObject({ syncToken: 'previous-token' })
    expect(primaryRequest).not.toHaveProperty('timeMin')
    expect(primaryRequest).not.toHaveProperty('timeMax')
  })

  it('recovers from an invalid incremental token with a bounded full sync', async () => {
    prisma.calendar.upsert.mockImplementation(({ create }: { create: { providerCalendarId: string } }) =>
      Promise.resolve(calendarRecord(
        create.providerCalendarId,
        create.providerCalendarId === 'primary' ? 'expired-token' : null,
      )))
    googleCalendar.events
      .mockRejectedValueOnce(Object.assign(new Error('Sync token expired'), { code: 410 }))
      .mockResolvedValue({
        data: {
          items: [],
          nextSyncToken: 'replacement-token',
        },
      })

    const result = await syncGoogleAccount('owner-123', 'account-1')

    expect(result.state).toBe('healthy')
    expect(prisma.calendar.update).toHaveBeenCalledWith({
      where: { id: 'calendar-primary' },
      data: { syncToken: null },
    })
    const recoveryRequest = googleCalendar.events.mock.calls[1][0]
    expect(recoveryRequest).not.toHaveProperty('syncToken')
    expect(recoveryRequest).toMatchObject({
      timeMin: expect.any(String),
      timeMax: expect.any(String),
    })
  })

  it('does not start provider work when another worker owns the account lock', async () => {
    prisma.calendarAccount.updateMany.mockResolvedValue({ count: 0 })

    const result = await syncGoogleAccount('owner-123', 'account-1')

    expect(result).toEqual({
      state: 'syncing',
      alreadyRunning: true,
      calendarsDiscovered: 0,
      calendarsSynced: 0,
      eventsUpserted: 0,
      eventsDeleted: 0,
      failures: [],
    })
    expect(prisma.calendarAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'account-1',
          userId: 'owner-123',
        }),
      }),
    )
    expect(googleCalendar.calendarList).not.toHaveBeenCalled()
  })

  it('does not treat another user account as an already-running sync', async () => {
    prisma.calendarAccount.updateMany.mockResolvedValue({ count: 0 })
    prisma.calendarAccount.findFirst.mockResolvedValue(null)

    await expect(syncGoogleAccount('intruder-456', 'account-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 })
    expect(googleCalendar.calendarList).not.toHaveBeenCalled()
  })

  it('polls due connected accounts through the same locked sync path', async () => {
    prisma.calendarAccount.findMany.mockResolvedValue([
      { id: 'account-1', userId: 'owner-123' },
    ])

    const queued = await syncDueGoogleAccounts(
      new Date('2026-07-29T12:00:00.000Z'),
    )

    expect(queued).toBe(1)
    expect(prisma.calendarAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: 'google',
          disconnectedAt: null,
          reconnectRequired: false,
        }),
        take: 25,
      }),
    )
    expect(prisma.calendarAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'account-1',
          userId: 'owner-123',
        }),
      }),
    )
  })
})

// ── LOS-403: Outbound Google Calendar sync ─────────────────────

describe('Google Calendar outbound sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    googleAuth.getAccessToken.mockResolvedValue({ token: 'stored-access-token' })
    googleCalendar.eventsInsert.mockResolvedValue({ data: { id: 'google-event-123' } })
    googleCalendar.eventsUpdate.mockResolvedValue({ data: { id: 'google-event-123' } })
    googleCalendar.eventsDelete.mockResolvedValue({})
  })

  it('syncs a scheduled task to Google Calendar and stores the event ID', async () => {
    prisma.task.findFirst.mockResolvedValue({
      id: 'task-1',
      title: 'Write API contract',
      description: 'Draft the LOS-403 contract',
      scheduledStart: new Date('2026-07-29T10:00:00.000Z'),
      scheduledEnd: new Date('2026-07-29T11:00:00.000Z'),
      estimatedEffort: null,
      status: 'todo',
      googleEventId: null,
      calendarSynced: false,
    })
    prisma.calendar.findFirst.mockResolvedValue({
      id: 'calendar-1',
      providerCalendarId: 'primary',
      readOnly: false,
      hidden: false,
      account: {
        id: 'account-1',
        googleAccessToken: encryptedAccess,
        googleRefreshToken: encryptedRefresh,
        tokenExpiresAt: new Date('2026-07-29T00:00:00.000Z'),
      },
    })
    prisma.task.update.mockResolvedValue({})

    const result = await syncTaskToGoogle('owner-123', 'task-1')

    expect(result).toEqual({
      ok: true,
      googleEventId: 'google-event-123',
      action: 'created',
    })
    expect(googleCalendar.eventsInsert).toHaveBeenCalledWith({
      calendarId: 'primary',
      requestBody: expect.objectContaining({
        summary: 'Write API contract',
        description: 'Draft the LOS-403 contract',
      }),
    })
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: {
        googleEventId: 'google-event-123',
        calendarSynced: true,
      },
    })
  })

  it('updates an already-synced task instead of creating a duplicate', async () => {
    prisma.task.findFirst.mockResolvedValue({
      id: 'task-1',
      title: 'Write API contract',
      description: null,
      scheduledStart: new Date('2026-07-29T10:00:00.000Z'),
      scheduledEnd: new Date('2026-07-29T11:00:00.000Z'),
      estimatedEffort: 1,
      status: 'todo',
      googleEventId: 'existing-google-event',
      calendarSynced: true,
    })
    prisma.calendar.findFirst.mockResolvedValue({
      id: 'calendar-1',
      providerCalendarId: 'primary',
      readOnly: false,
      hidden: false,
      account: {
        id: 'account-1',
        googleAccessToken: encryptedAccess,
        googleRefreshToken: encryptedRefresh,
        tokenExpiresAt: new Date('2026-07-29T00:00:00.000Z'),
      },
    })
    prisma.task.update.mockResolvedValue({})

    const result = await syncTaskToGoogle('owner-123', 'task-1')

    expect(result).toEqual({
      ok: true,
      googleEventId: 'google-event-123',
      action: 'updated',
    })
    expect(googleCalendar.eventsUpdate).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'existing-google-event',
      requestBody: expect.objectContaining({
        summary: 'Write API contract',
      }),
    })
    expect(googleCalendar.eventsInsert).not.toHaveBeenCalled()
  })

  it('rejects syncing an unscheduled task', async () => {
    prisma.task.findFirst.mockResolvedValue({
      id: 'task-1',
      title: 'Write API contract',
      description: null,
      scheduledStart: null,
      scheduledEnd: null,
      estimatedEffort: null,
      status: 'todo',
      googleEventId: null,
      calendarSynced: false,
    })

    await expect(syncTaskToGoogle('owner-123', 'task-1'))
      .rejects.toThrow('Task must be scheduled before syncing')
  })

  it('rejects syncing when no writable calendar is configured', async () => {
    prisma.task.findFirst.mockResolvedValue({
      id: 'task-1',
      title: 'Write API contract',
      description: null,
      scheduledStart: new Date('2026-07-29T10:00:00.000Z'),
      scheduledEnd: new Date('2026-07-29T11:00:00.000Z'),
      estimatedEffort: null,
      status: 'todo',
      googleEventId: null,
      calendarSynced: false,
    })
    prisma.calendar.findFirst.mockResolvedValue(null)

    await expect(syncTaskToGoogle('owner-123', 'task-1'))
      .rejects.toThrow('No writable Google Calendar configured')
  })

  it('rejects syncing another user task', async () => {
    prisma.task.findFirst.mockResolvedValue(null)

    await expect(syncTaskToGoogle('intruder-456', 'task-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 })
  })

  it('unsyncs a task by unlinking only (keeps Google event)', async () => {
    prisma.task.findFirst.mockResolvedValue({
      id: 'task-1',
      googleEventId: 'google-event-123',
      calendarSynced: true,
    })
    prisma.task.update.mockResolvedValue({})

    const result = await unsyncTaskFromGoogle('owner-123', 'task-1', false)

    expect(result).toEqual({
      ok: true,
      action: 'unlinked',
    })
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: {
        googleEventId: null,
        calendarSynced: false,
      },
    })
    expect(googleCalendar.eventsDelete).not.toHaveBeenCalled()
  })

  it('unsyncs a task by deleting the Google event and unlinking', async () => {
    prisma.task.findFirst.mockResolvedValue({
      id: 'task-1',
      googleEventId: 'google-event-123',
      calendarSynced: true,
    })
    prisma.calendar.findFirst.mockResolvedValue({
      id: 'calendar-1',
      providerCalendarId: 'primary',
      readOnly: false,
      hidden: false,
      account: {
        googleAccessToken: encryptedAccess,
        googleRefreshToken: encryptedRefresh,
        tokenExpiresAt: new Date('2026-07-29T00:00:00.000Z'),
      },
    })
    prisma.task.update.mockResolvedValue({})

    const result = await unsyncTaskFromGoogle('owner-123', 'task-1', true)

    expect(result).toEqual({
      ok: true,
      action: 'deleted_and_unlinked',
    })
    expect(googleCalendar.eventsDelete).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'google-event-123',
    })
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: {
        googleEventId: null,
        calendarSynced: false,
      },
    })
  })

  it('rejects unsyncing a task that is not synced', async () => {
    prisma.task.findFirst.mockResolvedValue({
      id: 'task-1',
      googleEventId: null,
      calendarSynced: false,
    })

    await expect(unsyncTaskFromGoogle('owner-123', 'task-1', false))
      .rejects.toThrow('Task is not synced to Google Calendar')
  })
})
