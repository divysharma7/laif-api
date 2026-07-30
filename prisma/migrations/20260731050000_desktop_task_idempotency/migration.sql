ALTER TABLE "tasks"
ADD COLUMN "client_command_id" TEXT;

CREATE UNIQUE INDEX "tasks_user_id_client_command_id_key"
ON "tasks"("user_id", "client_command_id");
