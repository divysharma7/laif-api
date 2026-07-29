import { google, calendar_v3 } from 'googleapis'
import { config } from '../config.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { getPrisma } from '../lib/prisma.js'
import { decryptSecret } from '../lib/secretEncryption.js'

type SyncToGoogleResult = {
  ok: boolean
  googleEventId: string
  action: 'created' | 'updated'
}

type UnsyncFromGoogleResult = {
  ok: boolean
  action: 'unlinked' | 'deleted_and_unlinked'
}

function getGoogleClient(account: {
  googleAccessToken: string
  googleRefreshToken: string | null
  tokenExpiresAt: Date | null
}) {
  const encryptionKey = config.GOOGLE_TOKEN_ENCRYPTION_KEY!
  const accessToken = decryptSecret(account.googleAccessToken, encryptionKey)
  const refreshToken = account.googleRefreshToken
    ? decryptSecret(account.googleRefreshToken, encryptionKey)
    : undefined

  const oauth2 = new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI,
  )
  oauth2.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: account.tokenExpiresAt?.getTime(),
  })
  return oauth2
}

function taskToGoogleEvent(task: {
  title: string
  description?: string | null
  scheduledStart: Date | null
  scheduledEnd: Date | null
  estimatedEffort: number | null
  status: string
}): calendar_v3.Schema$Event | null {
  if (!task.scheduledStart) return null

  const start = task.scheduledStart
  const durationMinutes = task.estimatedEffort ? Math.round(task.estimatedEffort * 60) : 30
  const end = task.scheduledEnd ?? new Date(start.getTime() + durationMinutes * 60 * 1000)

  return {
    summary: task.title,
    description: task.description || undefined,
    start: {
      dateTime: start.toISOString(),
    },
    end: {
      dateTime: end.toISOString(),
    },
    status: task.status === 'done' ? 'confirmed' : 'confirmed',
  }
}

export async function syncTaskToGoogle(
  userId: string,
  taskId: string,
): Promise<SyncToGoogleResult> {
  const prisma = getPrisma()

  // 1. Find the task and verify ownership
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId },
    select: {
      id: true,
      title: true,
      description: true,
      scheduledStart: true,
      scheduledEnd: true,
      estimatedEffort: true,
      status: true,
      googleEventId: true,
      calendarSynced: true,
    },
  })
  if (!task) throw new NotFoundError('Task', taskId)
  if (!task.scheduledStart) {
    throw new ValidationError('Task must be scheduled before syncing to Google Calendar')
  }

  // 2. Find the default write calendar
  const calendar = await prisma.calendar.findFirst({
    where: {
      userId,
      isDefaultWriteCalendar: true,
      hidden: false,
      readOnly: false,
      account: {
        disconnectedAt: null,
        provider: 'google',
      },
    },
    include: {
      account: {
        select: {
          id: true,
          googleAccessToken: true,
          googleRefreshToken: true,
          tokenExpiresAt: true,
        },
      },
    },
  })
  if (!calendar) {
    throw new ValidationError('No writable Google Calendar configured. Connect an account and set a default write calendar.')
  }

  // 3. Build the Google Calendar event
  const event = taskToGoogleEvent(task)
  if (!event) {
    throw new ValidationError('Cannot create Google Calendar event without a scheduled time')
  }

  // 4. Get Google API client
  const oauth2 = getGoogleClient(calendar.account)
  const api = google.calendar({ version: 'v3', auth: oauth2 })

  let googleEventId: string
  let action: 'created' | 'updated'

  if (task.googleEventId && task.calendarSynced) {
    // Update existing event
    try {
      const response = await api.events.update({
        calendarId: calendar.providerCalendarId,
        eventId: task.googleEventId,
        requestBody: event,
      })
      googleEventId = response.data.id!
      action = 'updated'
    } catch (error: unknown) {
      // If the event was deleted on Google's side, create a new one
      if ((error as { code?: number }).code === 404 || (error as { code?: number }).code === 410) {
        const response = await api.events.insert({
          calendarId: calendar.providerCalendarId,
          requestBody: event,
        })
        googleEventId = response.data.id!
        action = 'created'
      } else {
        throw error
      }
    }
  } else {
    // Create new event
    const response = await api.events.insert({
      calendarId: calendar.providerCalendarId,
      requestBody: event,
    })
    googleEventId = response.data.id!
    action = 'created'
  }

  // 5. Update task with Google event ID
  await prisma.task.update({
    where: { id: taskId },
    data: {
      googleEventId,
      calendarSynced: true,
    },
  })

  logger.info({ userId, taskId, googleEventId, action }, 'Task synced to Google Calendar')
  return { ok: true, googleEventId, action }
}

export async function unsyncTaskFromGoogle(
  userId: string,
  taskId: string,
  deleteGoogleEvent: boolean,
): Promise<UnsyncFromGoogleResult> {
  const prisma = getPrisma()

  // 1. Find the task and verify ownership
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId },
    select: {
      id: true,
      googleEventId: true,
      calendarSynced: true,
    },
  })
  if (!task) throw new NotFoundError('Task', taskId)
  if (!task.calendarSynced || !task.googleEventId) {
    throw new ValidationError('Task is not synced to Google Calendar')
  }

  // 2. Optionally delete the Google Calendar event
  if (deleteGoogleEvent) {
    // Find the calendar that owns this event
    const calendar = await prisma.calendar.findFirst({
      where: {
        userId,
        isDefaultWriteCalendar: true,
        hidden: false,
        account: {
          disconnectedAt: null,
          provider: 'google',
        },
      },
      include: {
        account: {
          select: {
            googleAccessToken: true,
            googleRefreshToken: true,
            tokenExpiresAt: true,
          },
        },
      },
    })

    if (calendar) {
      try {
        const oauth2 = getGoogleClient(calendar.account)
        const api = google.calendar({ version: 'v3', auth: oauth2 })
        await api.events.delete({
          calendarId: calendar.providerCalendarId,
          eventId: task.googleEventId,
        })
      } catch (error: unknown) {
        // If the event is already deleted on Google's side, that's fine
        if ((error as { code?: number }).code !== 404 && (error as { code?: number }).code !== 410) {
          logger.warn({ error, userId, taskId }, 'Failed to delete Google Calendar event during unsync')
        }
      }
    }
  }

  // 3. Clear the sync state on the task
  await prisma.task.update({
    where: { id: taskId },
    data: {
      googleEventId: null,
      calendarSynced: false,
    },
  })

  const action = deleteGoogleEvent ? 'deleted_and_unlinked' : 'unlinked'
  logger.info({ userId, taskId, action }, 'Task unsynced from Google Calendar')
  return { ok: true, action }
}
