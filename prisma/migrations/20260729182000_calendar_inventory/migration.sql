-- CreateEnum
CREATE TYPE "CalendarConnectionStatus" AS ENUM (
  'healthy',
  'syncing',
  'delayed',
  'needs_attention',
  'disconnected'
);

-- CreateTable
CREATE TABLE "calendar_accounts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" "ExternalCalendarSource" NOT NULL,
  "provider_account_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "display_name" TEXT NOT NULL DEFAULT '',
  "avatar_url" TEXT,
  "google_access_token" TEXT NOT NULL,
  "google_refresh_token" TEXT,
  "granted_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "token_expires_at" TIMESTAMPTZ(3),
  "status" "CalendarConnectionStatus" NOT NULL DEFAULT 'syncing',
  "last_sync_attempt_at" TIMESTAMPTZ(3),
  "last_successful_sync_at" TIMESTAMPTZ(3),
  "last_error_code" TEXT,
  "reconnect_required" BOOLEAN NOT NULL DEFAULT false,
  "disconnected_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "calendar_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendars" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "provider_calendar_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider_color" TEXT,
  "color_override" TEXT,
  "is_visible_in_calendar" BOOLEAN NOT NULL DEFAULT true,
  "is_active_in_agenda" BOOLEAN NOT NULL DEFAULT true,
  "affects_availability" BOOLEAN NOT NULL DEFAULT true,
  "is_default_write_calendar" BOOLEAN NOT NULL DEFAULT false,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "read_only" BOOLEAN NOT NULL DEFAULT false,
  "time_zone" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "sync_token" TEXT,
  "last_synced_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "calendars_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendars_active_visibility_check"
    CHECK (NOT "is_active_in_agenda" OR "is_visible_in_calendar"),
  CONSTRAINT "calendars_availability_group_check"
    CHECK ("affects_availability" = "is_active_in_agenda"),
  CONSTRAINT "calendars_sort_order_nonnegative_check"
    CHECK ("sort_order" >= 0)
);

-- ExtendTable
ALTER TABLE "external_calendar_events"
  ADD COLUMN "account_id" TEXT,
  ADD COLUMN "calendar_record_id" TEXT;

-- Replace the legacy user-level provider uniqueness rule with account ownership.
DROP INDEX "external_calendar_events_user_id_source_calendar_id_externa_key";

-- CreateIndex
CREATE UNIQUE INDEX "calendar_accounts_user_id_provider_provider_account_id_key"
  ON "calendar_accounts" ("user_id", "provider", "provider_account_id");

CREATE INDEX "calendar_accounts_user_id_provider_disconnected_at_idx"
  ON "calendar_accounts" ("user_id", "provider", "disconnected_at");

CREATE INDEX "calendar_accounts_user_id_status_last_successful_sync_at_idx"
  ON "calendar_accounts" ("user_id", "status", "last_successful_sync_at");

CREATE UNIQUE INDEX "calendars_account_id_provider_calendar_id_key"
  ON "calendars" ("account_id", "provider_calendar_id");

CREATE INDEX "calendars_user_id_is_active_in_agenda_hidden_sort_order_idx"
  ON "calendars" ("user_id", "is_active_in_agenda", "hidden", "sort_order");

CREATE INDEX "calendars_user_id_is_default_write_calendar_idx"
  ON "calendars" ("user_id", "is_default_write_calendar");

CREATE INDEX "calendars_account_id_hidden_sort_order_idx"
  ON "calendars" ("account_id", "hidden", "sort_order");

CREATE UNIQUE INDEX "calendars_one_default_write_per_user_key"
  ON "calendars" ("user_id")
  WHERE "is_default_write_calendar" = true AND "hidden" = false;

CREATE UNIQUE INDEX "external_calendar_events_account_id_calendar_id_external_id_key"
  ON "external_calendar_events" ("account_id", "calendar_id", "external_id");

CREATE INDEX "external_calendar_events_user_id_calendar_record_id_start_end_idx"
  ON "external_calendar_events" ("user_id", "calendar_record_id", "start", "end");

CREATE INDEX "external_calendar_events_account_id_calendar_id_start_idx"
  ON "external_calendar_events" ("account_id", "calendar_id", "start");

-- AddForeignKey
ALTER TABLE "calendar_accounts"
  ADD CONSTRAINT "calendar_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calendars"
  ADD CONSTRAINT "calendars_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calendars"
  ADD CONSTRAINT "calendars_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "calendar_accounts" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_calendar_events"
  ADD CONSTRAINT "external_calendar_events_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "calendar_accounts" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_calendar_events"
  ADD CONSTRAINT "external_calendar_events_calendar_record_id_fkey"
  FOREIGN KEY ("calendar_record_id") REFERENCES "calendars" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
