const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  formatterCache.set(timeZone, formatter)
  return formatter
}

function partsFor(date: Date, timeZone: string): Record<string, number> {
  return Object.fromEntries(
    getFormatter(timeZone)
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  )
}

function offsetAt(date: Date, timeZone: string): number {
  const parts = partsFor(date, timeZone)
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return representedAsUtc - date.getTime()
}

function localMidnightUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const localAsUtc = Date.UTC(year, month - 1, day)
  let candidate = localAsUtc - offsetAt(new Date(localAsUtc), timeZone)
  const corrected = localAsUtc - offsetAt(new Date(candidate), timeZone)
  if (corrected !== candidate) candidate = corrected
  return new Date(candidate)
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    getFormatter(timeZone).format(new Date(0))
    return true
  } catch {
    return false
  }
}

export function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

export function utcBoundsForLocalDate(
  date: string,
  timeZone: string,
): { start: Date; end: Date } {
  const [year, month, day] = date.split('-').map(Number)
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1))
  return {
    start: localMidnightUtc(year, month, day, timeZone),
    end: localMidnightUtc(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      timeZone,
    ),
  }
}

export function utcForLocalDateTime(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  let candidate = localAsUtc - offsetAt(new Date(localAsUtc), timeZone)
  const corrected = localAsUtc - offsetAt(new Date(candidate), timeZone)
  if (corrected !== candidate) candidate = corrected
  return new Date(candidate)
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = partsFor(date, timeZone)
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-')
}
