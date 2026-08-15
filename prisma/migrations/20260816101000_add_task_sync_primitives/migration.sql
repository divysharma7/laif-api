ALTER TABLE "tasks" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "task_tombstones" (
  "task_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "deleted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_tombstones_pkey" PRIMARY KEY ("task_id")
);

CREATE INDEX "task_tombstones_user_id_deleted_at_idx"
  ON "task_tombstones"("user_id", "deleted_at");

ALTER TABLE "task_tombstones"
  ADD CONSTRAINT "task_tombstones_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
