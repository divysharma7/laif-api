import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'
import {
  assertGeneratedSchemaName,
  assertLocalHttpUrl,
  assertLocalPostgresUrl,
  buildSchemaUrl,
  quoteGeneratedSchemaName,
} from './e2e-safety.mjs'

const { Client } = pg
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(scriptDir, '..')
const frontendRoot = path.resolve(backendRoot, '..')
const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js')
const backendTscCli = path.join(backendRoot, 'node_modules', 'typescript', 'bin', 'tsc')
const frontendTscCli = path.join(frontendRoot, 'node_modules', 'typescript', 'bin', 'tsc')
const viteCli = path.join(frontendRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const playwrightCli = path.join(frontendRoot, 'node_modules', '@playwright', 'test', 'cli.js')
const tsxCli = path.join(backendRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')

const frontendUrl = assertLocalHttpUrl(
  process.env.E2E_FRONTEND_URL ?? 'http://127.0.0.1:4173',
  'E2E_FRONTEND_URL',
).toString().replace(/\/$/, '')
const apiUrl = assertLocalHttpUrl(
  process.env.E2E_API_URL ?? 'http://127.0.0.1:4174',
  'E2E_API_URL',
).toString().replace(/\/$/, '')
const schemaName = assertGeneratedSchemaName(
  `laif_e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
)
const artifactDir = path.join(frontendRoot, 'test-results', 'full-stack', 'servers')
mkdirSync(artifactDir, { recursive: true })

const children = []
let schemaCreated = false
let postgresManager

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })

  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stderr.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    if (result.error) process.stderr.write(`${result.error.message}\n`)
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }

  return result
}

function startLoggedProcess(name, command, args, options) {
  const output = createWriteStream(path.join(artifactDir, `${name}.log`), { flags: 'w' })
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.pipe(output)
  child.stderr.pipe(output)
  children.push({ child, output })
  return child
}

async function waitForHttp(url, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = 'no response'

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      lastStatus = `HTTP ${response.status}`
      if (response.ok) return
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  throw new Error(`${label} did not become ready at ${url}: ${lastStatus}`)
}

async function waitForPostgres(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let lastError

  while (Date.now() < deadline) {
    const client = new Client({ connectionString: url })
    try {
      await client.connect()
      await client.query('SELECT 1')
      await client.end()
      return
    } catch (error) {
      lastError = error
      await client.end().catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  throw new Error(`Local PostgreSQL did not become ready: ${lastError instanceof Error ? lastError.message : lastError}`)
}

async function ensurePostgres() {
  if (!process.env.E2E_POSTGRES_ADMIN_URL) {
    throw new Error(
      'E2E_POSTGRES_ADMIN_URL is required. CI provisions PostgreSQL automatically; local runs must provide a loopback-only admin URL.',
    )
  }

  const adminUrl = assertLocalPostgresUrl(process.env.E2E_POSTGRES_ADMIN_URL).toString()
  await waitForPostgres(adminUrl)
  return {
    url: adminUrl,
    stop: async () => {},
  }
}

async function withAdminClient(adminUrl, action) {
  const client = new Client({ connectionString: adminUrl })
  await client.connect()
  try {
    return await action(client)
  } finally {
    await client.end()
  }
}

async function createSchema(adminUrl) {
  await withAdminClient(adminUrl, client => client.query(
    `CREATE SCHEMA ${quoteGeneratedSchemaName(schemaName)}`,
  ))
  schemaCreated = true
}

async function dropSchema(adminUrl) {
  if (!schemaCreated) return

  await withAdminClient(adminUrl, client => client.query(
    `DROP SCHEMA IF EXISTS ${quoteGeneratedSchemaName(schemaName)} CASCADE`,
  ))
  schemaCreated = false
}

async function reportMigrationFailures(databaseUrl) {
  const connectionUrl = new URL(databaseUrl)
  connectionUrl.searchParams.delete('schema')
  const client = new Client({ connectionString: connectionUrl.toString() })
  await client.connect()
  try {
    await client.query(`SET search_path TO ${quoteGeneratedSchemaName(schemaName)}`)
    const result = await client.query(`
      SELECT migration_name, finished_at, rolled_back_at, logs
        FROM "_prisma_migrations"
       ORDER BY started_at
    `)
    for (const row of result.rows) {
      const state = row.finished_at ? 'applied' : row.rolled_back_at ? 'rolled back' : 'failed'
      process.stderr.write(`Migration ${row.migration_name}: ${state}\n`)
      if (!row.finished_at) {
        process.stderr.write(`${row.logs ?? 'No migration log was recorded.'}\n`)
      }
    }
  } finally {
    await client.end()
  }
}

async function stopChildren() {
  for (const { child } of children.reverse()) {
    if (!child.killed) child.kill('SIGTERM')
  }

  await Promise.all(children.map(({ child }) => new Promise(resolve => {
    if (child.exitCode !== null) {
      resolve()
      return
    }
    const timeout = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL')
      resolve()
    }, 5_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })))

  for (const { output } of children) output.end()
}

async function main() {
  process.stdout.write('E2E safety guard passed: all mutable services are loopback-only.\n')
  run(process.execPath, ['--test', 'scripts/e2e-safety.test.mjs'], { cwd: backendRoot })

  postgresManager = await ensurePostgres()
  const adminUrl = assertLocalPostgresUrl(postgresManager.url).toString()
  await createSchema(adminUrl)
  const databaseUrl = buildSchemaUrl(adminUrl, schemaName)

  const backendEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: new URL(apiUrl).port,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'e2e-only-jwt-secret-that-is-never-used-outside-local-tests',
    CORS_ORIGINS: frontendUrl,
    FRONTEND_URL: frontendUrl,
    LOG_LEVEL: 'warn',
  }
  delete backendEnv.DEV_USER_ID

  const frontendEnv = {
    ...process.env,
    VITE_API_URL: apiUrl,
    VITE_USE_MOCK_AUTH: 'false',
  }

  try {
    run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: backendRoot,
      env: backendEnv,
    })
  } catch (error) {
    await reportMigrationFailures(databaseUrl).catch(reportError => {
      process.stderr.write(`Unable to read migration failure log: ${reportError.message}\n`)
    })
    throw error
  }
  run(process.execPath, [backendTscCli], { cwd: backendRoot, env: backendEnv })
  run(process.execPath, [frontendTscCli, '--noEmit'], { cwd: frontendRoot, env: frontendEnv })
  run(process.execPath, [viteCli, 'build', '--mode', 'e2e'], { cwd: frontendRoot, env: frontendEnv })

  startLoggedProcess('api', process.execPath, [tsxCli, path.join(backendRoot, 'dist', 'index.js')], {
    cwd: backendRoot,
    env: backendEnv,
  })
  await waitForHttp(`${apiUrl}/ready`, 'API readiness')

  startLoggedProcess(
    'frontend',
    process.execPath,
    [viteCli, 'preview', '--host', '127.0.0.1', '--port', new URL(frontendUrl).port, '--strictPort'],
    { cwd: frontendRoot, env: frontendEnv },
  )
  await waitForHttp(frontendUrl, 'Frontend preview')

  run(process.execPath, [
    playwrightCli,
    'test', '--config', 'playwright.fullstack.config.ts', ...process.argv.slice(2),
  ], {
    cwd: frontendRoot,
    env: {
      ...frontendEnv,
      E2E_API_URL: apiUrl,
      E2E_BASE_URL: frontendUrl,
    },
  })
}

let exitCode = 0
try {
  await main()
} catch (error) {
  exitCode = 1
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`)
} finally {
  await stopChildren().catch(error => {
    exitCode = 1
    process.stderr.write(`E2E service cleanup failed: ${error.message}\n`)
  })
  if (postgresManager) {
    await dropSchema(postgresManager.url).catch(error => {
      exitCode = 1
      process.stderr.write(`E2E schema cleanup failed: ${error.message}\n`)
    })
    await postgresManager.stop().catch(error => {
      exitCode = 1
      process.stderr.write(`Local Prisma cleanup failed: ${error.message}\n`)
    })
  }
}

process.exitCode = exitCode
