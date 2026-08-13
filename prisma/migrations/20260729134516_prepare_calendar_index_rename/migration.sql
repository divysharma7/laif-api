-- Compatibility bridge for clean databases.
--
-- The following historical migration renames an index that existed in its
-- original source schema but is absent from this repository's consolidated
-- baseline. Create a temporary same-named index so that historical migration
-- can remain checksum-stable. The 20260813 corrective migration replaces both
-- possible legacy names with Prisma's canonical inventory index definition.
CREATE INDEX IF NOT EXISTS "external_calendar_events_user_id_calendar_record_id_start_end_i"
  ON "external_calendar_events"("user_id", "start", "end");
