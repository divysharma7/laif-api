import { beforeEach, describe, expect, it, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  focusRecord: {
    aggregate: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({
  getPrisma: () => prisma,
}))

const { getOverview } = await import('../services/focusRecordService.js')

describe('Focus overview aggregation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aggregates today and all-time totals sequentially without fetching every record', async () => {
    let queryInFlight = false
    prisma.focusRecord.aggregate
      .mockImplementationOnce(async () => {
        expect(queryInFlight).toBe(false)
        queryInFlight = true
        await Promise.resolve()
        queryInFlight = false
        return { _sum: { pomoCount: 2, durationSeconds: 900 } }
      })
      .mockImplementationOnce(async () => {
        expect(queryInFlight).toBe(false)
        return { _sum: { pomoCount: 7, durationSeconds: 3600 } }
      })

    await expect(getOverview('user-123', 'UTC')).resolves.toEqual({
      todayPomo: 2,
      todayFocusSeconds: 900,
      totalPomo: 7,
      totalFocusSeconds: 3600,
    })
    expect(prisma.focusRecord.aggregate).toHaveBeenCalledTimes(2)
  })

  it('normalizes empty aggregate sums to zero', async () => {
    prisma.focusRecord.aggregate.mockResolvedValue({
      _sum: { pomoCount: null, durationSeconds: null },
    })

    await expect(getOverview('user-123', 'UTC')).resolves.toEqual({
      todayPomo: 0,
      todayFocusSeconds: 0,
      totalPomo: 0,
      totalFocusSeconds: 0,
    })
  })
})
