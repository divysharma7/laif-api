CREATE TABLE "task_attachments" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "filename" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "size" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_attachments_task_id_fkey" FOREIGN KEY ("task_id")
    REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "task_attachments_task_id_created_at_idx"
  ON "task_attachments"("task_id", "created_at");
