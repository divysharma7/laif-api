import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg
const adminUrl = process.env.FOCUS_VERIFY_ADMIN_URL

if (!adminUrl) {
  throw new Error('FOCUS_VERIFY_ADMIN_URL is required')
}

const parsedAdminUrl = new URL(adminUrl)
if (!['localhost', '127.0.0.1', '::1'].includes(parsedAdminUrl.hostname)) {
  throw new Error('Refusing to run migration verification against a non-local PostgreSQL host')
}

const migrationRoot = path.resolve('prisma/migrations')
const migrations = {
  init: '00000000000000_init',
  calendarIndexBridge: '20260729134516_prepare_calendar_index_rename',
  visibility: '20260729134517_add_event_visibility_transparency',
  inventory: '20260729182000_calendar_inventory',
  idempotency: '20260731050000_desktop_task_idempotency',
  focusFeature: '20260808_add_focus_records_and_settings',
  focusHardening: '20260809_harden_focus_sessions',
  focusRepair: '20260813_repair_focus_schema',
}

function migrationSql(name) {
  return readFileSync(path.join(migrationRoot, name, 'migration.sql'), 'utf8')
}

function schemaUrl(name) {
  const url = new URL(adminUrl)
  url.searchParams.set('schema', name)
  return url.toString()
}

function quoteIdentifier(identifier) {
  if (!/^codex_focus_[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe temporary database identifier: ${identifier}`)
  }
  return `"${identifier}"`
}

async function withClient(connectionString, action, schema) {
  const pgUrl = new URL(connectionString)
  pgUrl.searchParams.delete('schema')
  const client = new Client({ connectionString: pgUrl.toString() })
  await client.connect()
  try {
    if (schema) await client.query(`SET search_path TO ${quoteIdentifier(schema)}`)
    return await action(client)
  } finally {
    await client.end()
  }
}

async function createSchema(name) {
  await withClient(adminUrl, client => client.query(`CREATE SCHEMA ${quoteIdentifier(name)}`))
}

async function dropSchema(name) {
  await withClient(adminUrl, client => client.query(
    `DROP SCHEMA IF EXISTS ${quoteIdentifier(name)} CASCADE`,
  ))
}

function runPrisma(args, url) {
  const prismaCli = path.resolve('node_modules/prisma/build/index.js')
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error) process.stderr.write(`${result.error.message}\n`)
    throw new Error(`Prisma command failed: prisma ${args.join(' ')}`)
  }
}

async function applySqlFiles(url, schema, names) {
  await withClient(url, async client => {
    for (const name of names) {
      await client.query(migrationSql(name))
    }
  }, schema)
}

async function assertFocusSchema(url, schema, scenario) {
  await withClient(url, async client => {
    const enumResult = await client.query(`
      SELECT t.typname, array_agg(e.enumlabel::TEXT ORDER BY e.enumsortorder) AS labels
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typname IN ('FocusMode', 'FocusTargetType', 'FocusRecordSource')
         AND n.nspname = $1
       GROUP BY t.typname
    `, [schema])
    const enums = Object.fromEntries(enumResult.rows.map(row => [row.typname, row.labels]))
    if (JSON.stringify(enums.FocusMode) !== JSON.stringify(['POMO', 'STOPWATCH'])) {
      throw new Error(`${scenario}: FocusMode labels do not match`)
    }
    if (JSON.stringify(enums.FocusTargetType) !== JSON.stringify(['TASK', 'HABIT', 'NONE'])) {
      throw new Error(`${scenario}: FocusTargetType labels do not match`)
    }
    if (JSON.stringify(enums.FocusRecordSource) !== JSON.stringify(['TIMER', 'MANUAL'])) {
      throw new Error(`${scenario}: FocusRecordSource labels do not match`)
    }

    const columnsResult = await client.query(`
      SELECT table_name, column_name, udt_name, is_nullable, character_maximum_length
        FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name IN ('focus_sessions', 'focus_records', 'focus_settings')
    `, [schema])
    const columns = new Map(
      columnsResult.rows.map(row => [`${row.table_name}.${row.column_name}`, row]),
    )
    const requiredColumns = [
      'focus_sessions.mode',
      'focus_sessions.target_type',
      'focus_sessions.habit_id',
      'focus_records.id',
      'focus_records.user_id',
      'focus_records.target_type',
      'focus_records.target_id',
      'focus_records.start_time',
      'focus_records.end_time',
      'focus_records.duration_seconds',
      'focus_records.mode',
      'focus_records.note',
      'focus_settings.user_id',
      'focus_settings.pomo_duration_seconds',
      'focus_settings.notifications_enabled',
      'focus_settings.updated_at',
    ]
    for (const column of requiredColumns) {
      if (!columns.has(column)) throw new Error(`${scenario}: missing ${column}`)
    }
    if (columns.get('focus_sessions.post_session_note')?.character_maximum_length !== 2000) {
      throw new Error(`${scenario}: post_session_note is not VARCHAR(2000)`)
    }
    if (columns.get('focus_records.note')?.character_maximum_length !== 2000) {
      throw new Error(`${scenario}: focus_records.note is not VARCHAR(2000)`)
    }
    if (columns.get('focus_records.timezone')?.character_maximum_length !== 50) {
      throw new Error(`${scenario}: focus_records.timezone is not VARCHAR(50)`)
    }

    const indexesResult = await client.query(`
      SELECT indexname, indexdef
        FROM pg_indexes
       WHERE schemaname = $1
         AND indexname IN (
           'focus_sessions_user_id_target_type_started_at_idx',
           'focus_sessions_one_active_per_user_idx',
           'focus_records_user_id_start_time_idx',
           'focus_records_user_id_target_type_target_id_idx'
         )
    `, [schema])
    const indexes = new Map(indexesResult.rows.map(row => [row.indexname, row.indexdef]))
    if (indexes.size !== 4) throw new Error(`${scenario}: required Focus indexes are missing`)
    if (!indexes.get('focus_sessions_one_active_per_user_idx')?.includes('UNIQUE INDEX')) {
      throw new Error(`${scenario}: active-session index is not unique`)
    }
    if (!indexes.get('focus_sessions_one_active_per_user_idx')?.includes("WHERE (status = 'active'")) {
      throw new Error(`${scenario}: active-session index predicate is missing`)
    }

    const constraintsResult = await client.query(`
      SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = $1
         AND c.conname IN (
         'focus_records_pkey',
         'focus_settings_pkey',
         'focus_records_user_id_fkey',
         'focus_records_target_id_fkey',
         'focus_settings_user_id_fkey'
       )
    `, [schema])
    const constraints = new Set(constraintsResult.rows.map(row => row.conname))
    if (constraints.size !== 5) throw new Error(`${scenario}: required Focus constraints are missing`)

    await client.query(
      `INSERT INTO users (id, username, password_hash, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [`user-${scenario}`, `${scenario}@test.local`, 'test-only-hash'],
    )
    await client.query(
      `INSERT INTO focus_sessions
         (id, user_id, started_at, post_session_note, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP)`,
      [`session-${scenario}`, `user-${scenario}`, 'x'.repeat(2000)],
    )
    const noteLength = await client.query(
      'SELECT length(post_session_note) AS length FROM focus_sessions WHERE id = $1',
      [`session-${scenario}`],
    )
    if (noteLength.rows[0]?.length !== 2000) {
      throw new Error(`${scenario}: 2,000-character Focus note did not round-trip`)
    }
  }, schema)

  runPrisma(
    ['migrate', 'diff', '--exit-code', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma'],
    url,
  )
}

async function verifyClean(url, schema) {
  runPrisma(['migrate', 'deploy'], url)
  await assertFocusSchema(url, schema, 'clean')
}

async function verifyDrifted(url, schema) {
  await applySqlFiles(url, schema, [
    migrations.init,
    migrations.calendarIndexBridge,
    migrations.visibility,
    migrations.inventory,
    migrations.idempotency,
    migrations.focusHardening,
    migrations.focusRepair,
  ])
  await assertFocusSchema(url, schema, 'drifted')
}

async function verifyPartial(url, schema) {
  await applySqlFiles(url, schema, [
    migrations.init,
    migrations.calendarIndexBridge,
    migrations.visibility,
    migrations.inventory,
    migrations.idempotency,
  ])
  await withClient(url, client => client.query(`
    CREATE TYPE "FocusMode" AS ENUM ('POMO', 'STOPWATCH');
    CREATE TYPE "FocusTargetType" AS ENUM ('TASK', 'HABIT', 'NONE');
    CREATE TYPE "FocusRecordSource" AS ENUM ('TIMER', 'MANUAL');
    ALTER TABLE "focus_sessions"
      ADD COLUMN "mode" "FocusMode" NOT NULL DEFAULT 'POMO';
    CREATE TABLE "focus_records" ("id" TEXT NOT NULL);
    CREATE TABLE "focus_settings" ("user_id" TEXT NOT NULL);
  `), schema)
  await applySqlFiles(url, schema, [migrations.focusHardening, migrations.focusRepair])
  await assertFocusSchema(url, schema, 'partial')
}

async function verifyRecordedDrift(url, schema) {
  // Start from a fully recorded chain, then reproduce the production condition:
  // 20260808/09 remain recorded while their expected Focus DDL is absent.
  runPrisma(['migrate', 'deploy'], url)
  await withClient(url, client => client.query(`
    DROP TABLE "focus_records" CASCADE;
    DROP TABLE "focus_settings" CASCADE;
    ALTER TABLE "focus_sessions"
      DROP COLUMN "habit_id",
      DROP COLUMN "target_type",
      DROP COLUMN "mode",
      ALTER COLUMN "post_session_note" TYPE VARCHAR(200);
    DROP TYPE "FocusRecordSource";
    DROP TYPE "FocusTargetType";
    DROP TYPE "FocusMode";
    DELETE FROM "_prisma_migrations"
     WHERE migration_name IN (
       '20260729134516_prepare_calendar_index_rename',
       '20260813_repair_focus_schema'
     );
  `), schema)

  runPrisma(['migrate', 'deploy'], url)
  await assertFocusSchema(url, schema, 'recorded-drift')
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
const scenarios = [
  { name: `codex_focus_clean_${suffix}`, verify: verifyClean },
  { name: `codex_focus_drifted_${suffix}`, verify: verifyDrifted },
  { name: `codex_focus_partial_${suffix}`, verify: verifyPartial },
  { name: `codex_focus_recorded_${suffix}`, verify: verifyRecordedDrift },
]

try {
  for (const scenario of scenarios) {
    await createSchema(scenario.name)
    await scenario.verify(schemaUrl(scenario.name), scenario.name)
    process.stdout.write(`${scenario.name.split('_')[2]} Focus migration verification passed.\n`)
  }
} finally {
  for (const scenario of scenarios.reverse()) {
    await dropSchema(scenario.name).catch(error => {
      process.stderr.write(`Temporary schema cleanup failed for ${scenario.name}: ${error.message}\n`)
    })
  }
}
