import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertGeneratedSchemaName,
  assertLocalHttpUrl,
  assertLocalPostgresUrl,
  buildSchemaUrl,
  quoteGeneratedSchemaName,
} from './e2e-safety.mjs'

test('accepts loopback-only E2E service URLs', () => {
  assert.equal(assertLocalHttpUrl('http://127.0.0.1:4173', 'frontend').port, '4173')
  assert.equal(
    assertLocalPostgresUrl('postgresql://postgres:postgres@localhost:5432/template1').hostname,
    'localhost',
  )
})

test('rejects hosted API and database URLs before any mutation', () => {
  assert.throws(
    () => assertLocalHttpUrl('https://laif.example.com', 'frontend'),
    /loopback host/,
  )
  assert.throws(
    () => assertLocalPostgresUrl('postgresql://user:secret@db.example.com/prod'),
    /loopback host/,
  )
})

test('allows only harness-generated schema identifiers', () => {
  const schema = 'laif_e2e_012345abcdef'
  assert.equal(assertGeneratedSchemaName(schema), schema)
  assert.equal(quoteGeneratedSchemaName(schema), `"${schema}"`)
  assert.throws(() => assertGeneratedSchemaName('public'))
  assert.throws(() => assertGeneratedSchemaName('laif_e2e_bad;drop_schema'))
})

test('builds a local database URL with the generated schema', () => {
  const databaseUrl = buildSchemaUrl(
    'postgresql://postgres:postgres@127.0.0.1:5432/template1?schema=public&sslmode=disable',
    'laif_e2e_012345abcdef',
  )
  const parsed = new URL(databaseUrl)

  assert.equal(parsed.pathname, '/template1')
  assert.equal(parsed.searchParams.get('schema'), 'laif_e2e_012345abcdef')
  assert.equal(parsed.searchParams.get('sslmode'), 'disable')
})
