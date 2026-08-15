ALTER TABLE "tasks"
  ADD COLUMN "is_urgent" BOOLEAN,
  ADD COLUMN "is_important" BOOLEAN;

CREATE INDEX "tasks_user_id_is_important_is_urgent_idx"
  ON "tasks"("user_id", "is_important", "is_urgent");
