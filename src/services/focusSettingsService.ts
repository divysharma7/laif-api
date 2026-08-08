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
