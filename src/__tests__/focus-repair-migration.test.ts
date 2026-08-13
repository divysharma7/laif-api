import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../prisma/migrations/20260813_repair_focus_schema/migration.sql', import.meta.url),
  'utf8',
)

const calendarIndexBridgeMigration = readFileSync(
  new URL('../../prisma/migrations/20260729134516_prepare_calendar_index_rename/migration.sql', import.meta.url),
  'utf8',
)

describe('Focus corrective migration contract', () => {
  it('repairs all FocusSession additions including the skipped note widening', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "mode" "FocusMode"')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "target_type" "FocusTargetType"')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "habit_id" TEXT')
    expect(migration).toMatch(
      /ALTER COLUMN "post_session_note" TYPE VARCHAR\(2000\)/,
    )
    expect(migration).toContain('focus_sessions_one_active_per_user_idx')
  })

  it.each([
    '"id" TEXT NOT NULL',
    '"user_id" TEXT NOT NULL',
    '"target_type" "FocusTargetType" NOT NULL DEFAULT \'NONE\'',
    '"target_id" TEXT',
    '"target_title_snapshot" TEXT',
    '"start_time" TIMESTAMPTZ(3) NOT NULL',
    '"end_time" TIMESTAMPTZ(3) NOT NULL',
    '"duration_seconds" INTEGER NOT NULL',
    '"mode" "FocusMode" NOT NULL',
    '"pomo_count" INTEGER NOT NULL DEFAULT 0',
    '"note" VARCHAR(2000)',
    '"source" "FocusRecordSource" NOT NULL DEFAULT \'TIMER\'',
    '"timezone" VARCHAR(50)',
    '"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"updated_at" TIMESTAMPTZ(3) NOT NULL',
    '"deleted_at" TIMESTAMPTZ(3)',
  ])('repairs FocusRecord column %s when a table is partial', (definition) => {
    const repairSection = migration.slice(
      migration.indexOf('ALTER TABLE "focus_records"\n  ADD COLUMN'),
      migration.indexOf('ALTER TABLE "focus_records"\n  ALTER COLUMN'),
    )
    expect(repairSection).toContain(`ADD COLUMN IF NOT EXISTS ${definition}`)
  })

  it.each([
    '"user_id" TEXT NOT NULL',
    '"pomo_duration_seconds" INTEGER NOT NULL DEFAULT 1500',
    '"short_break_duration_seconds" INTEGER NOT NULL DEFAULT 300',
    '"long_break_duration_seconds" INTEGER NOT NULL DEFAULT 900',
    '"long_break_after_pomos" INTEGER NOT NULL DEFAULT 4',
    '"auto_start_break" BOOLEAN NOT NULL DEFAULT false',
    '"auto_start_pomo" BOOLEAN NOT NULL DEFAULT false',
    '"notifications_enabled" BOOLEAN NOT NULL DEFAULT true',
    '"sound_enabled" BOOLEAN NOT NULL DEFAULT true',
    '"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"updated_at" TIMESTAMPTZ(3) NOT NULL',
  ])('repairs FocusSettings column %s when a table is partial', (definition) => {
    const repairSection = migration.slice(
      migration.indexOf('ALTER TABLE "focus_settings"\n  ADD COLUMN'),
    )
    expect(repairSection).toContain(`ADD COLUMN IF NOT EXISTS ${definition}`)
  })

  it('reasserts the required indexes and ownership foreign keys', () => {
    expect(migration).toContain('focus_records_user_id_start_time_idx')
    expect(migration).toContain('focus_records_user_id_target_type_target_id_idx')
    expect(migration).toContain('focus_records_user_id_fkey')
    expect(migration).toContain('focus_records_target_id_fkey')
    expect(migration).toContain('focus_settings_user_id_fkey')
  })

  it('verifies same-named enums instead of silently accepting incompatible labels', () => {
    expect(migration).toContain("ARRAY['POMO', 'STOPWATCH']::TEXT[]")
    expect(migration).toContain("ARRAY['TASK', 'HABIT', 'NONE']::TEXT[]")
    expect(migration).toContain("ARRAY['TIMER', 'MANUAL']::TEXT[]")
  })
})

describe('clean migration-chain prerequisites', () => {
  it('bridges the baseline index gap without modifying applied history', () => {
    expect(calendarIndexBridgeMigration).toContain(
      'CREATE INDEX IF NOT EXISTS "external_calendar_events_user_id_calendar_record_id_start_end_i"',
    )
  })

  it('normalizes both legacy index names to the canonical Prisma definition', () => {
    expect(migration).toContain(
      'DROP INDEX IF EXISTS "external_calendar_events_user_id_calendar_record_id_start_end_i"',
    )
    expect(migration).toContain(
      'CREATE INDEX "external_calendar_events_user_id_calendar_record_id_start_e_idx"',
    )
  })
})
