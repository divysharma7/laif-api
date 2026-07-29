-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ListType" AS ENUM ('standard', 'habit', 'reading');

-- CreateEnum
CREATE TYPE "CollaboratorRole" AS ENUM ('creator', 'collaborator');

-- CreateEnum
CREATE TYPE "WorkflowTemplateType" AS ENUM ('kanban', 'sprint', 'sales', 'content', 'matrix', 'custom');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('backlog', 'todo', 'in-progress', 'done', 'dropped');

-- CreateEnum
CREATE TYPE "TaskRepeat" AS ENUM ('daily', 'weekdays', 'weekly', 'monthly', 'yearly');

-- CreateEnum
CREATE TYPE "HabitGoalType" AS ENUM ('binary', 'count');

-- CreateEnum
CREATE TYPE "HabitCompletionStatus" AS ENUM ('achieved', 'unachieved', 'skipped', 'frozen');

-- CreateEnum
CREATE TYPE "TaskReminderType" AS ENUM ('before-start', 'on-day-at', 'absolute');

-- CreateEnum
CREATE TYPE "FocusSessionStatus" AS ENUM ('active', 'completed', 'cancelled', 'extended');

-- CreateEnum
CREATE TYPE "FocusEndedReason" AS ENUM ('timer_ended', 'user_completed', 'user_cancelled');

-- CreateEnum
CREATE TYPE "PomodoroSessionType" AS ENUM ('focus', 'break');

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('book', 'movie', 'show', 'music', 'game', 'place', 'food', 'person', 'idea', 'quote', 'link', 'other');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('habit_reminder', 'checkin_nudge', 'streak_milestone');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "PushDeviceType" AS ENUM ('web', 'ios', 'android');

-- CreateEnum
CREATE TYPE "ExternalCalendarSource" AS ENUM ('google');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "password_hash" TEXT NOT NULL,
    "google_access_token" TEXT,
    "google_refresh_token" TEXT,
    "google_calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "google_calendar_connected" BOOLEAN NOT NULL DEFAULT false,
    "mcp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mcp_api_key" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "habit_settings" JSONB,
    "focus_preferences" JSONB,
    "calendar_preferences" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_groups" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "list_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lists" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "group_id" TEXT,
    "type" "ListType" NOT NULL DEFAULT 'standard',
    "title" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "cover_image_url" TEXT NOT NULL DEFAULT '',
    "is_private" BOOLEAN NOT NULL DEFAULT true,
    "pinned_to_favorites" BOOLEAN NOT NULL DEFAULT false,
    "hide_completed_tasks" BOOLEAN NOT NULL DEFAULT false,
    "blocks" JSONB,
    "is_inbox" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_collaborators" (
    "list_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT,
    "role" "CollaboratorRole" NOT NULL DEFAULT 'collaborator',
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "invited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(3),

    CONSTRAINT "list_collaborators_pkey" PRIMARY KEY ("list_id","user_id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '📋',
    "color" TEXT NOT NULL DEFAULT '#0f62fe',
    "template_type" "WorkflowTemplateType" NOT NULL DEFAULT 'kanban',
    "order" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_columns" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "wip_limit" INTEGER,

    CONSTRAINT "workflow_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kanban_sections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kanban_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workflow_id" TEXT,
    "section_id" TEXT,
    "list_id" TEXT,
    "parent_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "notes" JSONB,
    "due_date" TIMESTAMPTZ(3),
    "priority" "TaskPriority" DEFAULT 'medium',
    "status" "TaskStatus" NOT NULL DEFAULT 'backlog',
    "color" TEXT NOT NULL DEFAULT '#34d399',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "repeat" "TaskRepeat",
    "completed_at" TIMESTAMPTZ(3),
    "scheduled_start" TIMESTAMPTZ(3),
    "scheduled_end" TIMESTAMPTZ(3),
    "estimated_effort" DOUBLE PRECISION,
    "actual_effort" INTEGER NOT NULL DEFAULT 0,
    "google_event_id" TEXT,
    "calendar_synced" BOOLEAN NOT NULL DEFAULT false,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL DEFAULT '/',
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_habit" BOOLEAN NOT NULL DEFAULT false,
    "habit_goal_type" "HabitGoalType",
    "habit_target" INTEGER,
    "habit_unit" TEXT,
    "habit_frequency" JSONB,
    "streak_current" INTEGER NOT NULL DEFAULT 0,
    "streak_best" INTEGER NOT NULL DEFAULT 0,
    "streak_last_updated" TIMESTAMPTZ(3),
    "habit_reminder_time" VARCHAR(5),
    "habit_icon" TEXT,
    "habit_color" TEXT,
    "kanban_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "author_name" TEXT,
    "author_avatar" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_reminders" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "type" "TaskReminderType" NOT NULL DEFAULT 'before-start',
    "offset_minutes" INTEGER NOT NULL DEFAULT 15,
    "time_of_day" VARCHAR(5),
    "absolute_time" TIMESTAMPTZ(3),
    "sent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "task_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habit_completions" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "HabitCompletionStatus" NOT NULL,
    "value" INTEGER,
    "reason" TEXT,
    "logged_at" TIMESTAMPTZ(3),

    CONSTRAINT "habit_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_activities" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'event',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_date" TIMESTAMPTZ(3) NOT NULL,
    "end_date" TIMESTAMPTZ(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "color" TEXT NOT NULL DEFAULT '#5b8ded',
    "posthook_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_comments" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_calendar_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" "ExternalCalendarSource" NOT NULL DEFAULT 'google',
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "start" TIMESTAMPTZ(3) NOT NULL,
    "end" TIMESTAMPTZ(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "external_calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'reminder',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reminder_date" TIMESTAMPTZ(3) NOT NULL,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT NOT NULL DEFAULT '#fbbf24',
    "posthook_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_comments" (
    "id" TEXT NOT NULL,
    "reminder_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "focus_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT,
    "task_title_snapshot" TEXT,
    "planned_duration_min" INTEGER NOT NULL DEFAULT 25,
    "planned_break_min" INTEGER NOT NULL DEFAULT 5,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "paused_at" TIMESTAMPTZ(3),
    "total_paused_ms" INTEGER NOT NULL DEFAULT 0,
    "ended_at" TIMESTAMPTZ(3),
    "status" "FocusSessionStatus" NOT NULL DEFAULT 'active',
    "actual_duration_min" INTEGER NOT NULL DEFAULT 0,
    "extended_by_min" INTEGER NOT NULL DEFAULT 0,
    "ended_reason" "FocusEndedReason",
    "post_session_note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "focus_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pomodoro_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT,
    "task_title" TEXT NOT NULL DEFAULT '',
    "type" "PomodoroSessionType" NOT NULL,
    "duration" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pomodoro_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_session_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_session_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "linked_task_id" TEXT,
    "type" "MemoryType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT,
    "priority" "TaskPriority",
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_schedules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "skipped_reason" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_push_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "PushDeviceType" NOT NULL,
    "token" TEXT NOT NULL,
    "device_name" TEXT,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fcm_token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_mcp_api_key_key" ON "users"("mcp_api_key");

-- CreateIndex
CREATE INDEX "list_groups_owner_id_order_idx" ON "list_groups"("owner_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "list_groups_owner_id_title_key" ON "list_groups"("owner_id", "title");

-- CreateIndex
CREATE INDEX "lists_owner_id_deleted_at_created_at_idx" ON "lists"("owner_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "lists_owner_id_group_id_idx" ON "lists"("owner_id", "group_id");

-- CreateIndex
CREATE INDEX "lists_group_id_idx" ON "lists"("group_id");

-- CreateIndex
CREATE INDEX "list_collaborators_user_id_pending_idx" ON "list_collaborators"("user_id", "pending");

-- CreateIndex
CREATE INDEX "workflows_owner_id_archived_order_idx" ON "workflows"("owner_id", "archived", "order");

-- CreateIndex
CREATE INDEX "workflow_columns_workflow_id_idx" ON "workflow_columns"("workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_columns_workflow_id_order_key" ON "workflow_columns"("workflow_id", "order");

-- CreateIndex
CREATE INDEX "kanban_sections_user_id_order_idx" ON "kanban_sections"("user_id", "order");

-- CreateIndex
CREATE INDEX "tasks_user_id_created_at_idx" ON "tasks"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "tasks_user_id_status_due_date_idx" ON "tasks"("user_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "tasks_user_id_is_habit_order_idx" ON "tasks"("user_id", "is_habit", "order");

-- CreateIndex
CREATE INDEX "tasks_user_id_scheduled_start_idx" ON "tasks"("user_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "tasks_user_id_parent_id_order_idx" ON "tasks"("user_id", "parent_id", "order");

-- CreateIndex
CREATE INDEX "tasks_user_id_list_id_idx" ON "tasks"("user_id", "list_id");

-- CreateIndex
CREATE INDEX "tasks_user_id_workflow_id_section_id_kanban_order_idx" ON "tasks"("user_id", "workflow_id", "section_id", "kanban_order");

-- CreateIndex
CREATE INDEX "task_comments_task_id_created_at_idx" ON "task_comments"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "task_reminders_task_id_sent_idx" ON "task_reminders"("task_id", "sent");

-- CreateIndex
CREATE INDEX "task_reminders_sent_absolute_time_idx" ON "task_reminders"("sent", "absolute_time");

-- CreateIndex
CREATE INDEX "habit_completions_task_id_date_idx" ON "habit_completions"("task_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "habit_completions_task_id_date_key" ON "habit_completions"("task_id", "date");

-- CreateIndex
CREATE INDEX "task_activities_task_id_timestamp_idx" ON "task_activities"("task_id", "timestamp");

-- CreateIndex
CREATE INDEX "events_user_id_start_date_idx" ON "events"("user_id", "start_date");

-- CreateIndex
CREATE INDEX "events_user_id_end_date_idx" ON "events"("user_id", "end_date");

-- CreateIndex
CREATE INDEX "event_comments_event_id_created_at_idx" ON "event_comments"("event_id", "created_at");

-- CreateIndex
CREATE INDEX "external_calendar_events_user_id_start_end_idx" ON "external_calendar_events"("user_id", "start", "end");

-- CreateIndex
CREATE UNIQUE INDEX "external_calendar_events_user_id_source_calendar_id_externa_key" ON "external_calendar_events"("user_id", "source", "calendar_id", "external_id");

-- CreateIndex
CREATE INDEX "reminders_user_id_reminder_date_idx" ON "reminders"("user_id", "reminder_date");

-- CreateIndex
CREATE INDEX "reminders_user_id_notified_reminder_date_idx" ON "reminders"("user_id", "notified", "reminder_date");

-- CreateIndex
CREATE INDEX "reminder_comments_reminder_id_created_at_idx" ON "reminder_comments"("reminder_id", "created_at");

-- CreateIndex
CREATE INDEX "focus_sessions_user_id_status_started_at_idx" ON "focus_sessions"("user_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "focus_sessions_user_id_task_id_started_at_idx" ON "focus_sessions"("user_id", "task_id", "started_at");

-- CreateIndex
CREATE INDEX "pomodoro_sessions_user_id_started_at_idx" ON "pomodoro_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "pomodoro_sessions_user_id_task_id_started_at_idx" ON "pomodoro_sessions"("user_id", "task_id", "started_at");

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_updated_at_idx" ON "chat_sessions"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "chat_session_messages_session_id_timestamp_idx" ON "chat_session_messages"("session_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "chat_session_messages_session_id_position_key" ON "chat_session_messages"("session_id", "position");

-- CreateIndex
CREATE INDEX "memories_user_id_created_at_idx" ON "memories"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "memories_user_id_type_status_idx" ON "memories"("user_id", "type", "status");

-- CreateIndex
CREATE INDEX "memories_linked_task_id_idx" ON "memories"("linked_task_id");

-- CreateIndex
CREATE INDEX "notification_schedules_user_id_status_scheduled_for_idx" ON "notification_schedules"("user_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "notification_schedules_status_scheduled_for_idx" ON "notification_schedules"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "user_push_devices_token_key" ON "user_push_devices"("token");

-- CreateIndex
CREATE INDEX "user_push_devices_user_id_is_active_idx" ON "user_push_devices"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "devices_fcm_token_key" ON "devices"("fcm_token");

-- CreateIndex
CREATE INDEX "devices_user_id_updated_at_idx" ON "devices"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "web_push_subscriptions_user_id_updated_at_idx" ON "web_push_subscriptions"("user_id", "updated_at");

-- AddForeignKey
ALTER TABLE "list_groups" ADD CONSTRAINT "list_groups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lists" ADD CONSTRAINT "lists_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lists" ADD CONSTRAINT "lists_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "list_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_collaborators" ADD CONSTRAINT "list_collaborators_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_collaborators" ADD CONSTRAINT "list_collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_columns" ADD CONSTRAINT "workflow_columns_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_sections" ADD CONSTRAINT "kanban_sections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "workflow_columns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_completions" ADD CONSTRAINT "habit_completions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_comments" ADD CONSTRAINT "event_comments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_calendar_events" ADD CONSTRAINT "external_calendar_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_comments" ADD CONSTRAINT "reminder_comments_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pomodoro_sessions" ADD CONSTRAINT "pomodoro_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pomodoro_sessions" ADD CONSTRAINT "pomodoro_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_session_messages" ADD CONSTRAINT "chat_session_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_linked_task_id_fkey" FOREIGN KEY ("linked_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_schedules" ADD CONSTRAINT "notification_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_push_devices" ADD CONSTRAINT "user_push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Application invariants not expressible in Prisma Schema Language.
ALTER TABLE "events"
  ADD CONSTRAINT "events_dates_valid"
  CHECK ("end_date" >= "start_date");

ALTER TABLE "external_calendar_events"
  ADD CONSTRAINT "external_calendar_events_dates_valid"
  CHECK ("end" >= "start");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_schedule_valid"
  CHECK (
    "scheduled_start" IS NULL
    OR "scheduled_end" IS NULL
    OR "scheduled_end" >= "scheduled_start"
  ),
  ADD CONSTRAINT "tasks_habit_reminder_time_valid"
  CHECK (
    "habit_reminder_time" IS NULL
    OR "habit_reminder_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  ADD CONSTRAINT "tasks_nonnegative_positions"
  CHECK ("depth" >= 0 AND "order" >= 0 AND "kanban_order" >= 0);

ALTER TABLE "task_reminders"
  ADD CONSTRAINT "task_reminders_time_of_day_valid"
  CHECK (
    "time_of_day" IS NULL
    OR "time_of_day" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  );

ALTER TABLE "habit_completions"
  ADD CONSTRAINT "habit_completions_value_nonnegative"
  CHECK ("value" IS NULL OR "value" >= 0);

ALTER TABLE "focus_sessions"
  ADD CONSTRAINT "focus_sessions_durations_nonnegative"
  CHECK (
    "planned_duration_min" >= 0
    AND "planned_break_min" >= 0
    AND "total_paused_ms" >= 0
    AND "actual_duration_min" >= 0
    AND "extended_by_min" >= 0
  );

ALTER TABLE "pomodoro_sessions"
  ADD CONSTRAINT "pomodoro_sessions_duration_nonnegative"
  CHECK ("duration" >= 0);

ALTER TABLE "list_groups"
  ADD CONSTRAINT "list_groups_order_nonnegative"
  CHECK ("order" >= 0);

ALTER TABLE "workflows"
  ADD CONSTRAINT "workflows_order_nonnegative"
  CHECK ("order" >= 0);

ALTER TABLE "workflow_columns"
  ADD CONSTRAINT "workflow_columns_order_nonnegative"
  CHECK ("order" >= 0);

CREATE UNIQUE INDEX "users_username_case_insensitive_key"
  ON "users" (lower("username"));

CREATE UNIQUE INDEX "lists_one_active_inbox_per_owner_key"
  ON "lists" ("owner_id")
  WHERE "is_inbox" = true AND "deleted_at" IS NULL;

CREATE TABLE "oauth_states" (
    "jti" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX "oauth_states_user_id_provider_expires_at_idx"
  ON "oauth_states" ("user_id", "provider", "expires_at");

ALTER TABLE "oauth_states"
  ADD CONSTRAINT "oauth_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
