# LAIF API

Express/TypeScript API for LAIF Mobile, backed by PostgreSQL and Prisma.

## Included domains

Authentication, users/onboarding, tasks and hierarchy, structured notes, tags, lists/groups, workflows, habits/check-ins, calendar/capacity, Google Calendar, focus sessions and records, reminders and notification schedules, devices, chat sessions and local assistant grounding, rituals, attachments, statistics, export, account deletion, and task sync/conflict primitives.

Routes are served at `/api/v1` and `/api` for compatibility. Mobile uses `/api/v1`.

## Local setup

```bash
copy .env.example .env
npm install
npx prisma migrate dev
npm run dev
```

Required environment values are `DATABASE_URL` and a strong `JWT_SECRET`. Google Calendar is optional. External LLM calls are intentionally not enabled: the current assistant answers locally from authenticated user data without transmitting that data to another provider.

## Verification

```bash
npm run typecheck
npm run test:run
npx prisma validate
npm run security:secrets
```

Current verified baseline: TypeScript clean, Prisma valid, secret scan clean, and 149/149 tests passing.

## Mobile-facing additions

- Persisted onboarding and getting-started state.
- Task reminders materialized into notification schedules and recurring-task roll-forward.
- Idempotent daily morning/evening ritual records.
- User-owned task comments and inline attachments (3 MB maximum; JPEG, PNG, WebP, PDF, text).
- Consolidated task/focus/habit statistics.
- Explicit urgent/important matrix fields.
- Versioned structured task notes.
- Task `version` conflict checks and deletion tombstones at `/sync/tasks`.

For production, move attachment bytes to managed object storage, configure Firebase delivery credentials, configure Google OAuth, and run migrations through the deployment pipeline.
