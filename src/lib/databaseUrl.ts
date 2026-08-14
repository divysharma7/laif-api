export interface PrismaPgConnectionConfig {
  connectionString: string
  schema?: string
}

export function getPrismaPgConnectionConfig(databaseUrl: string): PrismaPgConnectionConfig {
  const parsed = new URL(databaseUrl)
  const schema = parsed.searchParams.get('schema')?.trim() || undefined
  parsed.searchParams.delete('schema')

  return {
    connectionString: parsed.toString(),
    schema,
  }
}
