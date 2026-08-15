import { beforeEach, describe, expect, it, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  focusSettings: {
    findUnique: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  getPrisma: () => prisma,
}))

const {
  addPreset,
  deletePreset,
  updatePreset,
} = await import('../services/focusSettingsService.js')

describe('focus custom presets', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    prisma.$transaction.mockImplementation(async (callback: (client: typeof prisma) => unknown) => callback(prisma))
    prisma.focusSettings.update.mockResolvedValue({})
  })

  it('stores presets as a JSON array and normalizes stopwatch duration', async () => {
    prisma.focusSettings.upsert.mockResolvedValue({ customPresets: [] })

    const preset = await addPreset('user-123', {
      name: 'Open-ended work',
      icon: '⏱️',
      mode: 'stopwatch',
      durationMinutes: 25,
    })

    expect(preset).toMatchObject({ name: 'Open-ended work', mode: 'stopwatch' })
    expect(preset.durationMinutes).toBeUndefined()
    const update = prisma.focusSettings.update.mock.calls[0][0]
    expect(Array.isArray(update.data.customPresets)).toBe(true)
    expect(update.data.customPresets[0]).toMatchObject({
      id: expect.any(String),
      name: 'Open-ended work',
      mode: 'stopwatch',
    })
    expect(update.data.customPresets[0]).not.toHaveProperty('durationMinutes')
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })
  })

  it('rejects changing a duration-free stopwatch preset to pomo', async () => {
    prisma.focusSettings.upsert.mockResolvedValue({
      customPresets: [{
        id: 'preset-1',
        name: 'Open ended',
        icon: '⏱️',
        mode: 'stopwatch',
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
      }],
    })

    await expect(updatePreset('user-123', 'preset-1', { mode: 'pomo' }))
      .rejects.toThrow('durationMinutes is required for pomo mode')
    expect(prisma.focusSettings.update).not.toHaveBeenCalled()
  })

  it('returns false without writing when a deleted preset does not exist', async () => {
    prisma.focusSettings.upsert.mockResolvedValue({ customPresets: [] })

    await expect(deletePreset('user-123', 'missing')).resolves.toBe(false)
    expect(prisma.focusSettings.update).not.toHaveBeenCalled()
  })

  it('bounds custom preset storage', async () => {
    prisma.focusSettings.upsert.mockResolvedValue({
      customPresets: Array.from({ length: 50 }, (_, index) => ({
        id: `preset-${index}`,
        name: `Preset ${index}`,
        icon: '🙂',
        mode: 'pomo',
        durationMinutes: 25,
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
      })),
    })

    await expect(addPreset('user-123', {
      name: 'One too many',
      icon: '🙂',
      mode: 'pomo',
      durationMinutes: 25,
    })).rejects.toThrow('A maximum of 50 custom presets is allowed')
    expect(prisma.focusSettings.update).not.toHaveBeenCalled()
  })
})
