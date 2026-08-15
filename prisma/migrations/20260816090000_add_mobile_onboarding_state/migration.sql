ALTER TABLE "users"
  ADD COLUMN "onboarding_state" JSONB,
  ADD COLUMN "onboarding_completed_at" TIMESTAMPTZ(3),
  ADD COLUMN "getting_started_state" JSONB;
