ALTER TABLE "focus_settings"
  ADD COLUMN IF NOT EXISTS "custom_presets" JSONB NOT NULL DEFAULT '[]'::jsonb;
