-- Corrective migration: the historical 20260808 migration is recorded as
-- applied in production, but its DDL never materialized. This migration
-- idempotently restores the missing Focus enums, columns, tables, indexes,
-- constraints, and foreign keys so the live schema matches schema.prisma.
--
-- The ALTER TABLE sections are intentional. CREATE TABLE IF NOT EXISTS does not
-- repair an existing partially materialized table.

-- Enums ---------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE "FocusMode" AS ENUM ('POMO', 'STOPWATCH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "FocusTargetType" AS ENUM ('TASK', 'HABIT', 'NONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "FocusRecordSource" AS ENUM ('TIMER', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fail loudly instead of silently accepting a same-named but incompatible enum.
DO $$
DECLARE
  labels TEXT[];
BEGIN
  SELECT array_agg(enumlabel ORDER BY enumsortorder)
    INTO labels
    FROM pg_enum
   WHERE enumtypid = '"FocusMode"'::regtype;
  IF labels IS DISTINCT FROM ARRAY['POMO', 'STOPWATCH']::TEXT[] THEN
    RAISE EXCEPTION 'FocusMode enum does not match the required labels';
  END IF;

  SELECT array_agg(enumlabel ORDER BY enumsortorder)
    INTO labels
    FROM pg_enum
   WHERE enumtypid = '"FocusTargetType"'::regtype;
  IF labels IS DISTINCT FROM ARRAY['TASK', 'HABIT', 'NONE']::TEXT[] THEN
    RAISE EXCEPTION 'FocusTargetType enum does not match the required labels';
  END IF;

  SELECT array_agg(enumlabel ORDER BY enumsortorder)
    INTO labels
    FROM pg_enum
   WHERE enumtypid = '"FocusRecordSource"'::regtype;
  IF labels IS DISTINCT FROM ARRAY['TIMER', 'MANUAL']::TEXT[] THEN
    RAISE EXCEPTION 'FocusRecordSource enum does not match the required labels';
  END IF;
END $$;

-- FocusSession --------------------------------------------------------------
ALTER TABLE "focus_sessions"
  ADD COLUMN IF NOT EXISTS "mode" "FocusMode" NOT NULL DEFAULT 'POMO',
  ADD COLUMN IF NOT EXISTS "target_type" "FocusTargetType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "habit_id" TEXT;

-- 20260808 widened this field, but production skipped that migration's DDL.
ALTER TABLE "focus_sessions"
  ALTER COLUMN "post_session_note" TYPE VARCHAR(2000);

DROP INDEX IF EXISTS "focus_sessions_user_id_target_type_started_at_idx";
CREATE INDEX "focus_sessions_user_id_target_type_started_at_idx"
  ON "focus_sessions"("user_id", "target_type", "started_at");

-- Reassert the later hardening migration in case its row was recorded without
-- its index or this corrective migration is applied to an intentionally partial
-- fixture. Creation fails safely if duplicate active rows must be resolved.
CREATE UNIQUE INDEX IF NOT EXISTS "focus_sessions_one_active_per_user_idx"
  ON "focus_sessions"("user_id")
  WHERE "status" = 'active';

-- FocusRecord ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "focus_records" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "target_type" "FocusTargetType" NOT NULL DEFAULT 'NONE',
  "target_id" TEXT,
  "target_title_snapshot" TEXT,
  "start_time" TIMESTAMPTZ(3) NOT NULL,
  "end_time" TIMESTAMPTZ(3) NOT NULL,
  "duration_seconds" INTEGER NOT NULL,
  "mode" "FocusMode" NOT NULL,
  "pomo_count" INTEGER NOT NULL DEFAULT 0,
  "note" VARCHAR(2000),
  "source" "FocusRecordSource" NOT NULL DEFAULT 'TIMER',
  "timezone" VARCHAR(50),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),

  CONSTRAINT "focus_records_pkey" PRIMARY KEY ("id")
);

-- Repair an existing empty/partial table. If required historical values cannot
-- be inferred safely, PostgreSQL stops the migration instead of inventing data.
ALTER TABLE "focus_records"
  ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "target_type" "FocusTargetType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "target_id" TEXT,
  ADD COLUMN IF NOT EXISTS "target_title_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "start_time" TIMESTAMPTZ(3) NOT NULL,
  ADD COLUMN IF NOT EXISTS "end_time" TIMESTAMPTZ(3) NOT NULL,
  ADD COLUMN IF NOT EXISTS "duration_seconds" INTEGER NOT NULL,
  ADD COLUMN IF NOT EXISTS "mode" "FocusMode" NOT NULL,
  ADD COLUMN IF NOT EXISTS "pomo_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "note" VARCHAR(2000),
  ADD COLUMN IF NOT EXISTS "source" "FocusRecordSource" NOT NULL DEFAULT 'TIMER',
  ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(3) NOT NULL,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(3);

ALTER TABLE "focus_records"
  ALTER COLUMN "note" TYPE VARCHAR(2000),
  ALTER COLUMN "timezone" TYPE VARCHAR(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'focus_records'::regclass
       AND contype = 'p'
  ) THEN
    ALTER TABLE "focus_records"
      ADD CONSTRAINT "focus_records_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

DROP INDEX IF EXISTS "focus_records_user_id_start_time_idx";
CREATE INDEX "focus_records_user_id_start_time_idx"
  ON "focus_records"("user_id", "start_time" DESC);

DROP INDEX IF EXISTS "focus_records_user_id_target_type_target_id_idx";
CREATE INDEX "focus_records_user_id_target_type_target_id_idx"
  ON "focus_records"("user_id", "target_type", "target_id");

ALTER TABLE "focus_records"
  DROP CONSTRAINT IF EXISTS "focus_records_user_id_fkey",
  DROP CONSTRAINT IF EXISTS "focus_records_target_id_fkey";

ALTER TABLE "focus_records"
  ADD CONSTRAINT "focus_records_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "focus_records_target_id_fkey"
    FOREIGN KEY ("target_id") REFERENCES "tasks"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- FocusSettings -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "focus_settings" (
  "user_id" TEXT NOT NULL,
  "pomo_duration_seconds" INTEGER NOT NULL DEFAULT 1500,
  "short_break_duration_seconds" INTEGER NOT NULL DEFAULT 300,
  "long_break_duration_seconds" INTEGER NOT NULL DEFAULT 900,
  "long_break_after_pomos" INTEGER NOT NULL DEFAULT 4,
  "auto_start_break" BOOLEAN NOT NULL DEFAULT false,
  "auto_start_pomo" BOOLEAN NOT NULL DEFAULT false,
  "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
  "sound_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "focus_settings_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "focus_settings"
  ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "pomo_duration_seconds" INTEGER NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS "short_break_duration_seconds" INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS "long_break_duration_seconds" INTEGER NOT NULL DEFAULT 900,
  ADD COLUMN IF NOT EXISTS "long_break_after_pomos" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS "auto_start_break" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "auto_start_pomo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "sound_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(3) NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'focus_settings'::regclass
       AND contype = 'p'
  ) THEN
    ALTER TABLE "focus_settings"
      ADD CONSTRAINT "focus_settings_pkey" PRIMARY KEY ("user_id");
  END IF;
END $$;

ALTER TABLE "focus_settings"
  DROP CONSTRAINT IF EXISTS "focus_settings_user_id_fkey";

ALTER TABLE "focus_settings"
  ADD CONSTRAINT "focus_settings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Replace both legacy/truncated variants with Prisma's canonical index name and
-- definition. One variant is produced by the compatibility bridge on a clean
-- install; the other may exist on databases that applied calendar inventory
-- before this repair.
DROP INDEX IF EXISTS "external_calendar_events_user_id_calendar_record_id_start_end_i";
DROP INDEX IF EXISTS "external_calendar_events_user_id_calendar_record_id_start_e_idx";
CREATE INDEX "external_calendar_events_user_id_calendar_record_id_start_e_idx"
  ON "external_calendar_events"("user_id", "calendar_record_id", "start", "end");
