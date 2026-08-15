import { getPrisma } from '../lib/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import { ValidationError } from '../lib/errors.js'

interface FocusSettingsData {
  pomoDurationSeconds?: number
  shortBreakDurationSeconds?: number
  longBreakDurationSeconds?: number
  longBreakAfterPomos?: number
  autoStartBreak?: boolean
  autoStartPomo?: boolean
  notificationsEnabled?: boolean
  soundEnabled?: boolean
}

export interface CustomPreset {
  id: string
  name: string
  icon: string
  mode: 'pomo' | 'stopwatch'
  durationMinutes?: number
  createdAt: string
  updatedAt: string
}

const MAX_CUSTOM_PRESETS = 50

const DEFAULT_SETTINGS = {
  pomoDurationSeconds: 1500,       // 25 minutes
  shortBreakDurationSeconds: 300,  // 5 minutes
  longBreakDurationSeconds: 900,   // 15 minutes
  longBreakAfterPomos: 4,
  autoStartBreak: false,
  autoStartPomo: false,
  notificationsEnabled: true,
  soundEnabled: true,
}

export async function getSettings(userId: string) {
  const prisma = getPrisma()

  let settings = await prisma.focusSettings.findUnique({
    where: { userId },
  })

  // Create default settings if not exists
  if (!settings) {
    settings = await prisma.focusSettings.create({
      data: {
        userId,
        ...DEFAULT_SETTINGS,
      },
    })
  }

  return settings
}

export async function updateSettings(userId: string, data: FocusSettingsData) {
  const prisma = getPrisma()

  // Ensure settings exist first
  await getSettings(userId)

  return prisma.focusSettings.update({
    where: { userId },
    data: {
      ...(data.pomoDurationSeconds !== undefined && { pomoDurationSeconds: data.pomoDurationSeconds }),
      ...(data.shortBreakDurationSeconds !== undefined && { shortBreakDurationSeconds: data.shortBreakDurationSeconds }),
      ...(data.longBreakDurationSeconds !== undefined && { longBreakDurationSeconds: data.longBreakDurationSeconds }),
      ...(data.longBreakAfterPomos !== undefined && { longBreakAfterPomos: data.longBreakAfterPomos }),
      ...(data.autoStartBreak !== undefined && { autoStartBreak: data.autoStartBreak }),
      ...(data.autoStartPomo !== undefined && { autoStartPomo: data.autoStartPomo }),
      ...(data.notificationsEnabled !== undefined && { notificationsEnabled: data.notificationsEnabled }),
      ...(data.soundEnabled !== undefined && { soundEnabled: data.soundEnabled }),
    },
  })
}

export async function deleteSettings(userId: string) {
  const prisma = getPrisma()

  try {
    await prisma.focusSettings.delete({
      where: { userId },
    })
  } catch {
    // Settings may not exist, ignore
  }
}

export async function getSettingsOrDefaults(userId: string) {
  try {
    return await getSettings(userId)
  } catch {
    return DEFAULT_SETTINGS
  }
}

// ── Custom Preset CRUD ──────────────────────────────────────────────────────

export async function getPresets(userId: string): Promise<CustomPreset[]> {
  const settings = await getSettings(userId)
  return parsePresets(settings.customPresets)
}

export async function addPreset(userId: string, preset: Omit<CustomPreset, 'id' | 'createdAt' | 'updatedAt'>): Promise<CustomPreset> {
  const result = await mutatePresets(userId, (presets) => {
    if (presets.length >= MAX_CUSTOM_PRESETS) {
      throw new ValidationError(`A maximum of ${MAX_CUSTOM_PRESETS} custom presets is allowed`)
    }
    const now = new Date().toISOString()
    const normalizedPreset = preset.mode === 'stopwatch'
      ? { ...preset, durationMinutes: undefined }
      : preset
    const newPreset: CustomPreset = {
      id: crypto.randomUUID(),
      ...normalizedPreset,
      createdAt: now,
      updatedAt: now,
    }
    return { value: newPreset, presets: [...presets, newPreset] }
  })
  return result!
}

export async function updatePreset(userId: string, presetId: string, updates: Partial<Omit<CustomPreset, 'id' | 'createdAt'>> & { durationMinutes?: number | null }): Promise<CustomPreset | null> {
  return mutatePresets(userId, (presets) => {
    const index = presets.findIndex((preset) => preset.id === presetId)
    if (index === -1) return null

    const current = presets[index]
    const next: CustomPreset = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    } as CustomPreset
    if (updates.durationMinutes === null || next.mode === 'stopwatch') {
      delete next.durationMinutes
    }
    if (next.mode === 'pomo' && next.durationMinutes === undefined) {
      throw new ValidationError('durationMinutes is required for pomo mode')
    }

    const nextPresets = [...presets]
    nextPresets[index] = next
    return { value: next, presets: nextPresets }
  })
}

export async function deletePreset(userId: string, presetId: string): Promise<boolean> {
  const result = await mutatePresets(userId, (presets) => {
    const filtered = presets.filter((preset) => preset.id !== presetId)
    if (filtered.length === presets.length) return null
    return { value: true, presets: filtered }
  })
  return result ?? false
}

function parsePresets(raw: unknown): CustomPreset[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw as CustomPreset[]
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed as CustomPreset[] : []
  } catch {
    return []
  }
}

function presetsJson(presets: CustomPreset[]): Prisma.InputJsonValue {
  return presets.map(({ durationMinutes, ...preset }) => ({
    ...preset,
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
  })) as Prisma.InputJsonValue
}

function isTransactionConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2034')
}

async function mutatePresets<T>(
  userId: string,
  mutate: (presets: CustomPreset[]) => { value: T; presets: CustomPreset[] } | null,
): Promise<T | null> {
  const prisma = getPrisma()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const settings = await tx.focusSettings.upsert({
          where: { userId },
          update: {},
          create: { userId, ...DEFAULT_SETTINGS },
        })
        const result = mutate(parsePresets(settings.customPresets))
        if (!result) return null
        await tx.focusSettings.update({
          where: { userId },
          data: { customPresets: presetsJson(result.presets) },
        })
        return result.value
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === 2) throw error
    }
  }
  return null
}
