import { getPrisma } from '../lib/prisma.js'

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
  const raw = settings.customPresets
  if (!raw) return []
  // customPresets is stored as JSON — could be an array or a string
  if (Array.isArray(raw)) return raw as unknown as CustomPreset[]
  try { return JSON.parse(raw as string) as CustomPreset[] } catch { return [] }
}

export async function addPreset(userId: string, preset: Omit<CustomPreset, 'id' | 'createdAt' | 'updatedAt'>): Promise<CustomPreset> {
  const prisma = getPrisma()
  const presets = await getPresets(userId)
  const now = new Date().toISOString()
  const newPreset: CustomPreset = {
    id: crypto.randomUUID(),
    ...preset,
    createdAt: now,
    updatedAt: now,
  }
  presets.push(newPreset)
  await prisma.focusSettings.update({
    where: { userId },
    data: { customPresets: JSON.stringify(presets) },
  })
  return newPreset
}

export async function updatePreset(userId: string, presetId: string, updates: Partial<Omit<CustomPreset, 'id' | 'createdAt'>> & { durationMinutes?: number | null }): Promise<CustomPreset | null> {
  const prisma = getPrisma()
  const presets = await getPresets(userId)
  const index = presets.findIndex((p) => p.id === presetId)
  if (index === -1) return null
  // Normalize: null durationMinutes → undefined
  const normalized = { ...updates }
  if (normalized.durationMinutes === null) normalized.durationMinutes = undefined
  presets[index] = { ...presets[index], ...normalized, updatedAt: new Date().toISOString() }
  await prisma.focusSettings.update({
    where: { userId },
    data: { customPresets: JSON.stringify(presets) },
  })
  return presets[index]
}

export async function deletePreset(userId: string, presetId: string): Promise<boolean> {
  const prisma = getPrisma()
  const presets = await getPresets(userId)
  const filtered = presets.filter((p) => p.id !== presetId)
  if (filtered.length === presets.length) return false
  await prisma.focusSettings.update({
    where: { userId },
    data: { customPresets: JSON.stringify(filtered) },
  })
  return true
}
