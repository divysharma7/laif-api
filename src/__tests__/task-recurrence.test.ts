import { describe, expect, it } from 'vitest'
import { nextRecurringDate } from '../services/taskRecurrenceService.js'

describe('recurring task calendar math', () => {
  it('clamps month-end instead of skipping February', () => {
    expect(nextRecurringDate(
      new Date('2026-01-31T09:30:00.000Z'),
      'monthly',
    )?.toISOString()).toBe('2026-02-28T09:30:00.000Z')
  })

  it('clamps a leap-day yearly recurrence to February 28', () => {
    expect(nextRecurringDate(
      new Date('2024-02-29T09:30:00.000Z'),
      'yearly',
    )?.toISOString()).toBe('2025-02-28T09:30:00.000Z')
  })

  it('moves a Friday weekday recurrence to Monday', () => {
    expect(nextRecurringDate(
      new Date('2026-08-14T09:30:00.000Z'),
      'weekdays',
    )?.toISOString()).toBe('2026-08-17T09:30:00.000Z')
  })
})
