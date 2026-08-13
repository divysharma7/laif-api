-- Corrective migration: the historical 20260808 migration is recorded as
-- applied in production, but its DDL never materialized. This migration
-- idempotently restores the missing Focus enums, columns, tables, indexes,
-- and foreign keys so the live schema matches schema.prisma again.

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

-- FocusSession columns -------------------------------------------------------
ALTER TABLE "focus_sessions"
  ADD COLUMN IF NOT EXISTS "mode" "FocusMode" NOT NULL DEFAULT 'POMO',
  ADD COLUMN IF NOT EXISTS "target_type" "FocusTargetType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "habit_id" TEXT;

CREATE INDEX IF NOT EXISTS "focus_sessions_user_id_target_type_started_at_idx"
  ON "focus_sessions"("user_id", "target_type", "started_at");

-- FocusRecord table ----------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS "focus_records_user_id_start_time_idx"
  ON "focus_records"("user_id", "start_time" DESC);

CREATE INDEX IF NOT EXISTS "focus_records_user_id_target_type_target_id_idx"
  ON "focus_records"("user_id", "target_type", "target_id");

-- FocusSettings table --------------------------------------------------------
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

-- Foreign keys ---------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE "focus_records"
    ADD CONSTRAINT "focus_records_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "focus_records"
    ADD CONSTRAINT "focus_records_target_id_fkey"
    FOREIGN KEY ("target_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "focus_settings"
    ADD CONSTRAINT "focus_settings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
