-- Enforce one active Focus Session per user, including across concurrent tabs.
CREATE UNIQUE INDEX "focus_sessions_one_active_per_user_idx"
ON "focus_sessions" ("user_id")
WHERE "status" = 'active';
