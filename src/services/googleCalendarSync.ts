import { google, calendar_v3 } from 'googleapis'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { NotFoundError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { getPrisma } from '../lib/prisma.js'
import { decryptSecret, encryptSecret } from '../lib/secretEncryption.js'

const INITIAL_SYNC_PAST_DAYS = 90
const INITIAL_SYNC_FUTURE_DAYS = 365
const LOCK_STALE_AFTER_MINUTES = 15
const GOOGLE_PROVIDER = 'google' as const

type ConnectionState = 'healthy' | 'syncing' | 'delayed' | 'needs_attention'

export type GoogleCalendarSyncResult = {
  state: ConnectionState
  alreadyRunning: boolean
  calendarsDiscovered: number
  calendarsSynced: number
  eventsUpserted: number
  eventsDeleted: number
  failures: string[]
}

type CalendarRecord = {
  id: string
  userId: string
  accountId: string
  providerCalendarId: string
  syncToken: string | null
  isPrimary: boolean
  readOnly: boolean
}

function emptyResult(state: ConnectionState): GoogleCalendarSyncResult {
  return {
    state,
    alreadyRunning: false,
    calendarsDiscovered: 0,
    calendarsSynced: 0,
    eventsUpserted: 0,
    eventsDeleted: 0,
    failures: [],
  }
}

function requiredGoogleConfig() {
  if (
    !config.GOOGLE_CLIENT_ID
    || !config.GOOGLE_CLIENT_SECRET
    || !config.GOOGLE_REDIRECT_URI
    || !config.GOOGLE_TOKEN_ENCRYPTION_KEY
  ) {
    throw new Error('Google Calendar integration is not configured')
  }
  return {
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    redirectUri: config.GOOGLE_REDIRECT_URI,
    encryptionKey: config.GOOGLE_TOKEN_ENCRYPTION_KEY,
  }
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'number') return error.code
  if ('response' in error && error.response && typeof error.response === 'object') {
    const response = error.response as { status?: unknown }
    if (typeof response.status === 'number') return response.status
  }
  return undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown Google Calendar sync error'
}

function isReconnectError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return errorStatus(error) === 401
    || message.includes('invalid_grant')
    || message.includes('invalid credentials')
}

function initialSyncWindow(now = new Date()) {
  const timeMin = new Date(now)
  timeMin.setUTCDate(timeMin.getUTCDate() - INITIAL_SYNC_PAST_DAYS)
  const timeMax = new Date(now)
  timeMax.setUTCDate(timeMax.getUTCDate() + INITIAL_SYNC_FUTURE_DAYS)
  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  }
}

function parseEventBoundary(boundary: calendar_v3.Schema$EventDateTime | undefined) {
  if (boundary?.dateTime) {
    const value = new Date(boundary.dateTime)
    return Number.isNaN(value.getTime()) ? null : { value, allDay: false }
  }
  if (boundary?.date) {
    const value = new Date(`${boundary.date}T00:00:00.000Z`)
    return Number.isNaN(value.getTime()) ? null : { value, allDay: true }
  }
  return null
}

async function refreshAccessToken(
  account: {
    id: string
    googleAccessToken: string
    googleRefreshToken: string | null
    tokenExpiresAt: Date | null
  },
) {
  const googleConfig = requiredGoogleConfig()
  const storedAccessToken = decryptSecret(
    account.googleAccessToken,
    googleConfig.encryptionKey,
  )
  const storedRefreshToken = account.googleRefreshToken
    ? decryptSecret(account.googleRefreshToken, googleConfig.encryptionKey)
    : undefined
  const oauth2 = new google.auth.OAuth2(
    googleConfig.clientId,
    googleConfig.clientSecret,
    googleConfig.redirectUri,
  )
  oauth2.setCredentials({
    access_token: storedAccessToken,
    refresh_token: storedRefreshToken,
    expiry_date: account.tokenExpiresAt?.getTime(),
  })

  const accessToken = await oauth2.getAccessToken()
  const refreshedToken = accessToken.token
  if (!refreshedToken) throw new Error('Google did not return an access token')

  const refreshedCredentials = oauth2.credentials
  const tokenUpdate: {
    googleAccessToken?: string
    googleRefreshToken?: string
    tokenExpiresAt?: Date | null
  } = {}
  if (refreshedToken !== storedAccessToken) {
    tokenUpdate.googleAccessToken = encryptSecret(
      refreshedToken,
      googleConfig.encryptionKey,
    )
  }
  if (
    refreshedCredentials?.refresh_token
    && refreshedCredentials.refresh_token !== storedRefreshToken
  ) {
    tokenUpdate.googleRefreshToken = encryptSecret(
      refreshedCredentials.refresh_token,
      googleConfig.encryptionKey,
    )
  }
  if (refreshedCredentials?.expiry_date !== undefined) {
    tokenUpdate.tokenExpiresAt = refreshedCredentials.expiry_date
      ? new Date(refreshedCredentials.expiry_date)
      : null
  }
  if (Object.keys(tokenUpdate).length > 0) {
    await getPrisma().calendarAccount.update({
      where: { id: account.id },
      data: tokenUpdate,
    })
  }
  return oauth2
}

async function discoverCalendars(
  userId: string,
  accountId: string,
  api: calendar_v3.Calendar,
): Promise<CalendarRecord[]> {
  const prisma = getPrisma()
  const providerCalendarIds: string[] = []
  const calendars: CalendarRecord[] = []
  let pageToken: string | undefined
  let sortOrder = 0

  do {
    const response = await api.calendarList.list({
      maxResults: 250,
      pageToken,
      showDeleted: false,
      showHidden: false,
    })
    for (const item of response.data.items ?? []) {
      if (!item.id) continue
      const isPrimary = item.primary === true
      const isSelected = item.selected === true
      const isVisible = isPrimary || isSelected || item.hidden !== true
      const isActive = isVisible && (isPrimary || isSelected)
      const readOnly = !['owner', 'writer'].includes(item.accessRole ?? '')
      providerCalendarIds.push(item.id)
      const calendar = await prisma.calendar.upsert({
        where: {
          accountId_providerCalendarId: {
            accountId,
            providerCalendarId: item.id,
          },
        },
        create: {
          userId,
          accountId,
          providerCalendarId: item.id,
          name: item.summaryOverride || item.summary || 'Untitled calendar',
          providerColor: item.backgroundColor || null,
          isVisibleInCalendar: isVisible,
          isActiveInAgenda: isActive,
          affectsAvailability: isActive,
          isPrimary,
          readOnly,
          timeZone: item.timeZone || null,
          sortOrder,
          hidden: false,
        },
        update: {
          name: item.summaryOverride || item.summary || 'Untitled calendar',
          providerColor: item.backgroundColor || null,
          isPrimary,
          readOnly,
          timeZone: item.timeZone || null,
          hidden: false,
        },
      })
      calendars.push(calendar as CalendarRecord)
      sortOrder += 1
    }
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  await prisma.calendar.updateMany({
    where: {
      accountId,
      providerCalendarId: { notIn: providerCalendarIds },
    },
    data: {
      hidden: true,
      isActiveInAgenda: false,
      affectsAvailability: false,
      isDefaultWriteCalendar: false,
    },
  })

  const currentDefault = await prisma.calendar.findFirst({
    where: {
      userId,
      isDefaultWriteCalendar: true,
      hidden: false,
      readOnly: false,
    },
    select: { id: true },
  })
  const primaryWritable = calendars.find(calendar =>
    calendar.isPrimary && !calendar.readOnly)
  if (!currentDefault && primaryWritable) {
    await prisma.calendar.update({
      where: { id: primaryWritable.id },
      data: { isDefaultWriteCalendar: true },
    })
  }

  return calendars
}

async function applyEvent(
  userId: string,
  accountId: string,
  calendar: CalendarRecord,
  event: calendar_v3.Schema$Event,
  result: GoogleCalendarSyncResult,
) {
  if (!event.id) return
  const prisma = getPrisma()
  if (event.status === 'cancelled') {
    const deleted = await prisma.externalCalendarEvent.deleteMany({
      where: {
        userId,
        accountId,
        calendarId: calendar.providerCalendarId,
        externalId: event.id,
      },
    })
    result.eventsDeleted += deleted.count
    return
  }

  const start = parseEventBoundary(event.start)
  const end = parseEventBoundary(event.end)
  if (!start || !end || end.value <= start.value) return
  const syncedAt = new Date()

  // Handle private events — hide title
  const isPrivate = event.visibility === 'private' || event.visibility === 'confidential'
  const title = isPrivate ? 'Busy' : (event.summary || 'Busy')

  // Handle transparency — 'transparent' means free, 'opaque' means busy
  const transparency = event.transparency === 'transparent' ? 'transparent' : 'opaque'

  const eventData = {
    title,
    start: start.value,
    end: end.value,
    allDay: start.allDay,
    visibility: event.visibility || 'public',
    transparency,
    lastSyncedAt: syncedAt,
    calendarRecordId: calendar.id,
  }
  await prisma.externalCalendarEvent.upsert({
    where: {
      accountId_calendarId_externalId: {
        accountId,
        calendarId: calendar.providerCalendarId,
        externalId: event.id,
      },
    },
    create: {
      userId,
      source: GOOGLE_PROVIDER,
      accountId,
      calendarId: calendar.providerCalendarId,
      externalId: event.id,
      ...eventData,
    },
    update: eventData,
  })
  result.eventsUpserted += 1
}

async function pullCalendarEvents(
  userId: string,
  accountId: string,
  calendar: CalendarRecord,
  api: calendar_v3.Calendar,
  result: GoogleCalendarSyncResult,
): Promise<void> {
  const prisma = getPrisma()
  const syncToken = calendar.syncToken
  const window = initialSyncWindow()
  let pageToken: string | undefined
  let nextSyncToken: string | null = null

  try {
    do {
      const response = await api.events.list({
        calendarId: calendar.providerCalendarId,
        maxResults: 2500,
        pageToken,
        showDeleted: true,
        singleEvents: true,
        ...(syncToken
          ? { syncToken }
          : { timeMin: window.timeMin, timeMax: window.timeMax }),
      })
      for (const event of response.data.items ?? []) {
        await applyEvent(userId, accountId, calendar, event, result)
      }
      pageToken = response.data.nextPageToken ?? undefined
      if (!pageToken) nextSyncToken = response.data.nextSyncToken ?? null
    } while (pageToken)
  } catch (error) {
    if (syncToken && errorStatus(error) === 410) {
      await prisma.calendar.update({
        where: { id: calendar.id },
        data: { syncToken: null },
      })
      await pullCalendarEvents(
        userId,
        accountId,
        { ...calendar, syncToken: null },
        api,
        result,
      )
      return
    }
    throw error
  }

  await prisma.calendar.update({
    where: { id: calendar.id },
    data: {
      syncToken: nextSyncToken || syncToken,
      lastSyncedAt: new Date(),
    },
  })
}

export async function syncGoogleAccount(
  userId: string,
  accountId: string,
): Promise<GoogleCalendarSyncResult> {
  const prisma = getPrisma()
  const result = emptyResult('syncing')
  const syncId = randomUUID()
  const startTime = Date.now()
  const staleLockThreshold = new Date(
    Date.now() - LOCK_STALE_AFTER_MINUTES * 60 * 1000,
  )

  logger.info({ syncId, userId, accountId }, 'Google sync started')

  const lock = await prisma.calendarAccount.updateMany({
    where: {
      id: accountId,
      userId,
      provider: GOOGLE_PROVIDER,
      disconnectedAt: null,
      OR: [
        { status: { not: 'syncing' } },
        { lastSyncAttemptAt: null },
        { lastSyncAttemptAt: { lt: staleLockThreshold } },
      ],
    },
    data: {
      status: 'syncing',
      lastSyncAttemptAt: new Date(),
      lastErrorCode: null,
    },
  })
  if (lock.count === 0) {
    const existingAccount = await prisma.calendarAccount.findFirst({
      where: {
        id: accountId,
        userId,
        provider: GOOGLE_PROVIDER,
        disconnectedAt: null,
      },
      select: { id: true },
    })
    if (!existingAccount) throw new NotFoundError('Calendar account', accountId)
    logger.info({ syncId, userId, accountId }, 'Google sync skipped — already running')
    return { ...result, alreadyRunning: true }
  }

  try {
    const account = await prisma.calendarAccount.findFirst({
      where: {
        id: accountId,
        userId,
        provider: GOOGLE_PROVIDER,
        disconnectedAt: null,
      },
      select: {
        id: true,
        googleAccessToken: true,
        googleRefreshToken: true,
        tokenExpiresAt: true,
      },
    })
    if (!account) throw new NotFoundError('Calendar account', accountId)

    const oauth2 = await refreshAccessToken(account)
    const api = google.calendar({ version: 'v3', auth: oauth2 })
    const calendars = await discoverCalendars(userId, accountId, api)
    result.calendarsDiscovered = calendars.length

    logger.info({ syncId, userId, accountId, calendarsDiscovered: calendars.length }, 'Google sync: calendars discovered')

    for (const calendar of calendars) {
      try {
        await pullCalendarEvents(userId, accountId, calendar, api, result)
        result.calendarsSynced += 1
      } catch (error) {
        if (isReconnectError(error)) throw error
        const message = errorMessage(error)
        result.failures.push(`${calendar.providerCalendarId}: ${message}`)
        logger.warn(
          { syncId, userId, accountId, calendarId: calendar.providerCalendarId, error: message },
          'Google sync: calendar failed',
        )
      }
    }

    const durationMs = Date.now() - startTime
    result.state = result.failures.length === 0 ? 'healthy' : 'delayed'
    await prisma.calendarAccount.update({
      where: { id: accountId },
      data: {
        status: result.state,
        reconnectRequired: false,
        lastErrorCode: result.failures.length > 0 ? 'PARTIAL_SYNC' : null,
        ...(result.calendarsSynced > 0 || calendars.length === 0
          ? { lastSuccessfulSyncAt: new Date() }
          : {}),
      },
    })

    logger.info({
      syncId,
      userId,
      accountId,
      durationMs,
      state: result.state,
      calendarsDiscovered: result.calendarsDiscovered,
      calendarsSynced: result.calendarsSynced,
      eventsUpserted: result.eventsUpserted,
      eventsDeleted: result.eventsDeleted,
      failures: result.failures.length,
    }, 'Google sync completed')

    return result
  } catch (error) {
    const durationMs = Date.now() - startTime
    const reconnectRequired = isReconnectError(error)
    result.state = reconnectRequired ? 'needs_attention' : 'delayed'
    result.failures.push(errorMessage(error))

    logger.error({
      syncId,
      userId,
      accountId,
      durationMs,
      state: result.state,
      reconnectRequired,
      error: errorMessage(error),
    }, 'Google sync failed')

    await prisma.calendarAccount.update({
      where: { id: accountId },
      data: {
        status: result.state,
        reconnectRequired,
        lastErrorCode: reconnectRequired ? 'GOOGLE_RECONNECT_REQUIRED' : 'SYNC_FAILED',
      },
    })
    throw error
  }
}

export async function syncDueGoogleAccounts(now = new Date()): Promise<number> {
  const dueBefore = new Date(
    now.getTime() - config.GOOGLE_SYNC_INTERVAL_MINUTES * 60 * 1000,
  )
  const accounts = await getPrisma().calendarAccount.findMany({
    where: {
      provider: GOOGLE_PROVIDER,
      disconnectedAt: null,
      reconnectRequired: false,
      OR: [
        { lastSuccessfulSyncAt: null },
        { lastSuccessfulSyncAt: { lt: dueBefore } },
      ],
    },
    select: {
      id: true,
      userId: true,
    },
    orderBy: {
      lastSuccessfulSyncAt: 'asc',
    },
    take: 25,
  })
  await Promise.allSettled(
    accounts.map(account => syncGoogleAccount(account.userId, account.id)),
  )
  return accounts.length
}
