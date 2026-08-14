const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function parseUrl(value, label) {
  if (!value) throw new Error(`${label} is required`)

  try {
    return new URL(value)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
}

function assertLoopback(url, label) {
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${label} must use a loopback host; received ${url.hostname}`)
  }
}

export function assertLocalPostgresUrl(value, label = 'E2E_POSTGRES_ADMIN_URL') {
  const url = parseUrl(value, label)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${label} must use postgres:// or postgresql://`)
  }
  assertLoopback(url, label)
  return url
}

export function assertLocalHttpUrl(value, label) {
  const url = parseUrl(value, label)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must use http:// or https://`)
  }
  assertLoopback(url, label)
  return url
}

export function assertGeneratedSchemaName(name) {
  if (!/^laif_e2e_[a-f0-9]{12}$/.test(name)) {
    throw new Error(`Unsafe E2E schema name: ${name}`)
  }
  return name
}

export function buildSchemaUrl(adminUrl, schemaName) {
  const url = new URL(assertLocalPostgresUrl(adminUrl))
  const safeName = assertGeneratedSchemaName(schemaName)
  url.searchParams.set('schema', safeName)
  return url.toString()
}

export function quoteGeneratedSchemaName(name) {
  return `"${assertGeneratedSchemaName(name)}"`
}
