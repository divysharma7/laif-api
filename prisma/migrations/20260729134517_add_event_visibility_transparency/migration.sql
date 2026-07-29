-- AlterTable
ALTER TABLE "external_calendar_events" ADD COLUMN     "transparency" TEXT NOT NULL DEFAULT 'opaque',
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'public';

-- RenameIndex
ALTER INDEX "external_calendar_events_user_id_calendar_record_id_start_end_i" RENAME TO "external_calendar_events_user_id_calendar_record_id_start_e_idx";
