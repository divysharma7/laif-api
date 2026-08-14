import { describe, expect, it } from 'vitest'
import { getPrismaPgConnectionConfig } from '../lib/databaseUrl.js'

describe('PostgreSQL adapter connection configuration', () => {
  it('passes ordinary connection URLs through unchanged', () => {
    expect(getPrismaPgConnectionConfig('postgresql://user:pass@localhost:5432/laif')).toEqual({
      connectionString: 'postgresql://user:pass@localhost:5432/laif',
      schema: undefined,
    })
  })

  it('moves Prisma schema selection into the driver adapter option', () => {
    const result = getPrismaPgConnectionConfig(
      'postgresql://user:pass@localhost:5432/laif?sslmode=disable&schema=laif_e2e_012345abcdef',
    )

    expect(result.schema).toBe('laif_e2e_012345abcdef')
    expect(result.connectionString).toContain('sslmode=disable')
    expect(result.connectionString).not.toContain('schema=')
  })
})
