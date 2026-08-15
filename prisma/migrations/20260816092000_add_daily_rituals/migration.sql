CREATE TYPE "DailyRitualType" AS ENUM ('morning', 'evening');

CREATE TABLE "daily_rituals" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "type" "DailyRitualType" NOT NULL,
  "outcome" VARCHAR(500),
  "payload" JSONB NOT NULL DEFAULT '{}',
  "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "daily_rituals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_rituals_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "daily_rituals_user_id_date_type_key"
  ON "daily_rituals"("user_id", "date", "type");
CREATE INDEX "daily_rituals_user_id_date_idx"
  ON "daily_rituals"("user_id", "date" DESC);
