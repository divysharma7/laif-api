import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response, type NextFunction } from 'express'
import { SignJWT, jwtVerify } from 'jose'
import { getPrisma } from '../../lib/prisma.js'
import { config } from '../../config.js'
import { NotFoundError, ValidationError } from '../../lib/errors.js'
import { encryptSecret } from '../../lib/secretEncryption.js'
import { syncGoogleAccount } from '../../services/googleCalendarSync.js'
import {
  CalendarInventoryUpdateSchema,
  DisconnectGoogleAccountSchema,
  GoogleCalendarSyncSchema,
  parseBody,
} from '../../lib/validation.js'

const router = Router()
const oauthStateSecret = new TextEncoder().encode(config.JWT_SECRET)
const GOOGLE_OAUTH_PURPOSE = 'google-calendar-oauth'
const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
]

function googleIntegrationConfigured(): boolean {
  return Boolean(
    config.GOOGLE_CLIENT_ID
    && config.GOOGLE_CLIENT_SECRET
    && config.GOOGLE_REDIRECT_URI
    && config.GOOGLE_TOKEN_ENCRYPTION_KEY,
  )
}

function settingsRedirect(status: 'connected' | 'cancelled' | 'error'): string {
  const url = new URL('/settings', config.FRONTEND_URL)
  url.searchParams.set('tab', 'integrations')
  url.searchParams.set('google', status)
  return url.toString()
}

type CalendarWithAccount = {
  id: string
  accountId: string
  providerCalendarId: string
  name: string
  providerColor: string | null
  colorOverride: string | null
  readOnly: boolean
  isActiveInAgenda: boolean
  isVisibleInCalendar: boolean
  isDefaultWriteCalendar: boolean
  sortOrder: number
  account: {
    email: string
    displayName: string
  }
}

function serializeCalendar(calendar: CalendarWithAccount) {
  return {
    id: calendar.id,
    accountId: calendar.accountId,
    providerCalendarId: calendar.providerCalendarId,
    name: calendar.name,
    color: calendar.colorOverride || calendar.providerColor || '#4285f4',
    accountEmail: calendar.account.email,
    accountLabel: calendar.account.displayName || calendar.account.email,
    readOnly: calendar.readOnly,
    group: calendar.isActiveInAgenda ? 'active' : 'passive',
    visible: calendar.isVisibleInCalendar,
    order: calendar.sortOrder,
    isDefaultWrite: calendar.isDefaultWriteCalendar,
  }
}

const calendarAccountInclude = {
  calendars: {
    where: { hidden: false },
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      name: true,
      isActiveInAgenda: true,
    },
  },
}

const calendarWithAccountInclude = {
  account: {
    select: {
      email: true,
      displayName: true,
    },
  },
}

async function createOAuthState(userId: string): Promise<string> {
  const jti = randomUUID()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  await getPrisma().oAuthState.create({
    data: { jti, userId, provider: 'google', expiresAt },
  })
  return new SignJWT({ purpose: GOOGLE_OAUTH_PURPOSE })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(oauthStateSecret)
}

async function verifyOAuthState(
  state: string,
  authenticatedUserId: string,
): Promise<{ userId: string; jti: string }> {
  const { payload } = await jwtVerify(state, oauthStateSecret)
  if (
    payload.purpose !== GOOGLE_OAUTH_PURPOSE
    || typeof payload.sub !== 'string'
    || typeof payload.jti !== 'string'
    || payload.sub !== authenticatedUserId
  ) {
    throw new Error('Invalid OAuth state')
  }
  return { userId: payload.sub, jti: payload.jti }
}

async function consumeOAuthState(
  state: string,
  authenticatedUserId: string,
): Promise<string> {
  const verified = await verifyOAuthState(state, authenticatedUserId)
  const consumed = await getPrisma().oAuthState.updateMany({
    where: {
      jti: verified.jti,
      userId: verified.userId,
      provider: 'google',
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  })
  if (consumed.count !== 1) throw new Error('OAuth state was already used')
  return verified.userId
}

router.get('/auth', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!googleIntegrationConfigured()) {
      res.status(501).json({ error: 'Google integration not configured' })
      return
    }
    const { google } = await import('googleapis')
    const oauth2 = new google.auth.OAuth2(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      config.GOOGLE_REDIRECT_URI,
    )
    const state = await createOAuthState(req.userId!)
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      include_granted_scopes: true,
      prompt: 'consent',
      scope: GOOGLE_CALENDAR_SCOPES,
      state,
    })
    res.json({ url })
  } catch (err) { next(err) }
})

router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as Record<string, string>
    if (!state) {
      res.status(400).json({ error: 'Missing OAuth state' })
      return
    }

    let userId: string
    try {
      userId = await consumeOAuthState(state, req.userId!)
    } catch {
      res.status(400).json({ error: 'Invalid or expired OAuth state' })
      return
    }

    if (error) {
      res.redirect(settingsRedirect(error === 'access_denied' ? 'cancelled' : 'error'))
      return
    }
    if (!code) {
      res.status(400).json({ error: 'Missing authorization code' })
      return
    }
    if (!googleIntegrationConfigured()) {
      res.status(501).json({ error: 'Google integration not configured' })
      return
    }

    const { google } = await import('googleapis')
    const oauth2 = new google.auth.OAuth2(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      config.GOOGLE_REDIRECT_URI,
    )
    const { tokens } = await oauth2.getToken(code)
    if (!tokens.access_token) {
      throw new Error('Google did not return an access token')
    }
    oauth2.setCredentials(tokens)
    const oauthApi = google.oauth2({ version: 'v2', auth: oauth2 })
    const { data: profile } = await oauthApi.userinfo.get()
    if (!profile.id || !profile.email) {
      throw new Error('Google did not return a stable account identity')
    }

    const encryptionKey = config.GOOGLE_TOKEN_ENCRYPTION_KEY!
    const encryptedAccessToken = encryptSecret(tokens.access_token, encryptionKey)
    const encryptedRefreshToken = tokens.refresh_token
      ? encryptSecret(tokens.refresh_token, encryptionKey)
      : undefined
    const accountIdentity = {
      email: profile.email,
      displayName: profile.name || profile.email,
      avatarUrl: profile.picture || null,
      googleAccessToken: encryptedAccessToken,
      grantedScopes: tokens.scope?.split(' ').filter(Boolean) ?? GOOGLE_CALENDAR_SCOPES,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      status: 'syncing' as const,
      lastErrorCode: null,
      reconnectRequired: false,
      disconnectedAt: null,
      ...(encryptedRefreshToken
        ? { googleRefreshToken: encryptedRefreshToken }
        : {}),
    }
    const account = await getPrisma().calendarAccount.upsert({
      where: {
        userId_provider_providerAccountId: {
          userId,
          provider: 'google',
          providerAccountId: profile.id,
        },
      },
      create: {
        userId,
        provider: 'google',
        providerAccountId: profile.id,
        ...accountIdentity,
      },
      update: accountIdentity,
    })
    res.redirect(settingsRedirect('connected'))
    void syncGoogleAccount(userId, account.id).catch(() => {
      // The account status records the failure; the OAuth redirect must still complete.
    })
  } catch (err) { next(err) }
})

router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const account = await getPrisma().calendarAccount.findFirst({
      where: {
        userId: req.userId!,
        provider: 'google',
        disconnectedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        calendars: {
          where: { isDefaultWriteCalendar: true, hidden: false },
          select: { providerCalendarId: true },
          take: 1,
        },
      },
    })
    res.json({
      connected: Boolean(account),
      calendarId: account?.calendars[0]?.providerCalendarId || 'primary',
    })
  } catch (err) { next(err) }
})

router.get('/accounts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = await getPrisma().calendarAccount.findMany({
      where: {
        userId: req.userId!,
        provider: 'google',
        disconnectedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      include: calendarAccountInclude,
    })
    res.json(accounts.map(account => ({
      id: account.id,
      email: account.email,
      displayName: account.displayName || account.email,
      ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
      status: account.reconnectRequired ? 'needs_attention' : account.status,
      lastSyncAt: account.lastSuccessfulSyncAt?.toISOString() ?? null,
      calendars: account.calendars.map(calendar => ({
        id: calendar.id,
        name: calendar.name,
        selected: calendar.isActiveInAgenda,
      })),
    })))
  } catch (err) {
    next(err)
  }
})

router.get('/calendars', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const calendars = await getPrisma().calendar.findMany({
      where: {
        userId: req.userId!,
        hidden: false,
        account: {
          provider: 'google',
          disconnectedAt: null,
        },
      },
      orderBy: [
        { isActiveInAgenda: 'desc' },
        { sortOrder: 'asc' },
        { id: 'asc' },
      ],
      include: calendarWithAccountInclude,
    })
    res.json(calendars.map(calendar => serializeCalendar(calendar)))
  } catch (err) {
    next(err)
  }
})

router.patch(
  '/calendars/:calendarId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseBody(CalendarInventoryUpdateSchema, req.body)
      if (!parsed.success) throw new ValidationError(parsed.error)

      const prisma = getPrisma()
      const userId = req.userId!
      const existing = await prisma.calendar.findFirst({
        where: {
          id: req.params.calendarId,
          userId,
          hidden: false,
        },
        include: {
          account: {
            select: { disconnectedAt: true },
          },
        },
      })
      if (!existing) throw new NotFoundError('Calendar', req.params.calendarId)

      if (parsed.data.isDefaultWrite && (existing.readOnly || existing.account.disconnectedAt)) {
        throw new ValidationError('Default write calendar must be writable and connected')
      }
      const targetIsActive = parsed.data.group === 'active'
        || (parsed.data.group === undefined && existing.isActiveInAgenda)
      if (parsed.data.visible === false && targetIsActive) {
        throw new ValidationError('Move an active calendar to Passive before hiding it')
      }

      const data: {
        isActiveInAgenda?: boolean
        affectsAvailability?: boolean
        isVisibleInCalendar?: boolean
        sortOrder?: number
        colorOverride?: string | null
        isDefaultWriteCalendar?: boolean
      } = {}
      if (parsed.data.group === 'active') {
        data.isActiveInAgenda = true
        data.affectsAvailability = true
        data.isVisibleInCalendar = true
      } else if (parsed.data.group === 'passive') {
        data.isActiveInAgenda = false
        data.affectsAvailability = false
      }
      if (parsed.data.visible !== undefined) {
        data.isVisibleInCalendar = parsed.data.visible
      }
      if (parsed.data.order !== undefined) data.sortOrder = parsed.data.order
      if (parsed.data.color !== undefined) data.colorOverride = parsed.data.color
      if (parsed.data.isDefaultWrite !== undefined) {
        data.isDefaultWriteCalendar = parsed.data.isDefaultWrite
      }

      const calendar = await prisma.$transaction(async transaction => {
        if (parsed.data.isDefaultWrite) {
          await transaction.calendar.updateMany({
            where: { userId, isDefaultWriteCalendar: true },
            data: { isDefaultWriteCalendar: false },
          })
        }
        return transaction.calendar.update({
          where: { id: existing.id },
          data,
          include: calendarWithAccountInclude,
        })
      })
      res.json(serializeCalendar(calendar))
    } catch (err) {
      next(err)
    }
  },
)

router.post('/disconnect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(DisconnectGoogleAccountSchema, req.body ?? {})
    if (!parsed.success) throw new ValidationError(parsed.error)
    const disconnectedAt = new Date()
    const result = await getPrisma().calendarAccount.updateMany({
      where: {
        userId: req.userId!,
        provider: 'google',
        disconnectedAt: null,
        ...(parsed.data.accountId ? { id: parsed.data.accountId } : {}),
      },
      data: {
        status: 'disconnected',
        disconnectedAt,
        googleAccessToken: '',
        googleRefreshToken: null,
      },
    })
    if (parsed.data.accountId && result.count === 0) {
      throw new NotFoundError('Calendar account', parsed.data.accountId)
    }
    res.json({ ok: true, disconnected: result.count })
  } catch (err) { next(err) }
})

router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(GoogleCalendarSyncSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const result = await syncGoogleAccount(req.userId!, parsed.data.accountId)
    res.json({ ok: true, ...result })
  } catch (err) { next(err) }
})

router.post('/unsync', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ok: true, message: 'Task unsynced from Google Calendar' })
  } catch (err) { next(err) }
})

export default router
