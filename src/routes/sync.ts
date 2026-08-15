import { Router, type NextFunction, type Request, type Response } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { ValidationError } from '../lib/errors.js'

const router = Router()

type CursorKind = 'task' | 'tombstone'
type SyncCursor = {
  after: string
  kind?: CursorKind
  id?: string
  upperBound?: string
  exclusiveTimestamp?: boolean
}

type SyncEvent = {
  kind: CursorKind
  id: string
  timestamp: Date
  value: Record<string, unknown>
}

function decodeCursor(value: unknown): SyncCursor {
  if (value === undefined) {
    return { after: new Date(0).toISOString(), exclusiveTimestamp: true }
  }
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new ValidationError('cursor must be a valid sync cursor')
  }
  const legacyDate = new Date(value)
  if (!Number.isNaN(legacyDate.getTime())) {
    return { after: legacyDate.toISOString(), exclusiveTimestamp: true }
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as SyncCursor
    const after = new Date(parsed.after)
    const upperBound = parsed.upperBound ? new Date(parsed.upperBound) : null
    if (
      Number.isNaN(after.getTime())
      || (upperBound && Number.isNaN(upperBound.getTime()))
      || (parsed.kind !== undefined && parsed.kind !== 'task' && parsed.kind !== 'tombstone')
      || (parsed.id !== undefined && typeof parsed.id !== 'string')
    ) {
      throw new Error('invalid cursor')
    }
    return {
      after: after.toISOString(),
      ...(parsed.kind ? { kind: parsed.kind } : {}),
      ...(parsed.id ? { id: parsed.id } : {}),
      ...(upperBound ? { upperBound: upperBound.toISOString() } : {}),
      ...(parsed.exclusiveTimestamp ? { exclusiveTimestamp: true } : {}),
    }
  } catch {
    throw new ValidationError('cursor must be a valid sync cursor')
  }
}

function encodeCursor(cursor: SyncCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function afterFilter(
  field: 'updatedAt' | 'deletedAt',
  idField: 'id' | 'taskId',
  kind: CursorKind,
  cursor: SyncCursor,
  upperBound: Date,
) {
  const after = new Date(cursor.after)
  if (cursor.exclusiveTimestamp || !cursor.kind || !cursor.id) {
    return { [field]: { gt: after, lte: upperBound } }
  }

  const includeSameTimestamp = kind > cursor.kind
    ? {}
    : kind === cursor.kind
      ? { [idField]: { gt: cursor.id } }
      : null
  return {
    AND: [
      { [field]: { lte: upperBound } },
      {
        OR: [
          { [field]: { gt: after } },
          ...(includeSameTimestamp === null ? [] : [{
            [field]: after,
            ...includeSameTimestamp,
          }]),
        ],
      },
    ],
  }
}

router.get('/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cursor = decodeCursor(req.query.cursor)
    const limitValue = Number(req.query.limit)
    if (req.query.limit !== undefined && (!Number.isInteger(limitValue) || limitValue < 1)) {
      throw new ValidationError('limit must be a positive integer')
    }
    const limit = Math.min(500, limitValue || 200)
    const upperBound = cursor.upperBound ? new Date(cursor.upperBound) : new Date()
    const prisma = getPrisma()

    // Sequential calls avoid protocol collisions seen with the production driver adapter.
    const tasks = await prisma.task.findMany({
      where: {
        userId: req.userId!,
        ...afterFilter('updatedAt', 'id', 'task', cursor, upperBound),
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    })
    const tombstones = await prisma.taskTombstone.findMany({
      where: {
        userId: req.userId!,
        ...afterFilter('deletedAt', 'taskId', 'tombstone', cursor, upperBound),
      },
      orderBy: [{ deletedAt: 'asc' }, { taskId: 'asc' }],
      take: limit + 1,
    })

    const events: SyncEvent[] = [
      ...tasks.map(({ id, status, updatedAt, ...task }) => ({
        kind: 'task' as const,
        id,
        timestamp: updatedAt,
        value: {
          ...task,
          _id: id,
          updatedAt,
          status: status === 'in_progress' ? 'in-progress' : status,
        },
      })),
      ...tombstones.map(({ taskId, deletedAt }) => ({
        kind: 'tombstone' as const,
        id: taskId,
        timestamp: deletedAt,
        value: { taskId, deletedAt },
      })),
    ].sort((left, right) => (
      left.timestamp.getTime() - right.timestamp.getTime()
      || left.kind.localeCompare(right.kind)
      || left.id.localeCompare(right.id)
    ))

    const page = events.slice(0, limit)
    const hasMore = events.length > limit
    const last = page.at(-1)
    const nextCursor = hasMore && last
      ? encodeCursor({
          after: last.timestamp.toISOString(),
          kind: last.kind,
          id: last.id,
          upperBound: upperBound.toISOString(),
        })
      : encodeCursor({ after: upperBound.toISOString(), exclusiveTimestamp: true })

    res.json({
      changes: page.filter(event => event.kind === 'task').map(event => event.value),
      tombstones: page.filter(event => event.kind === 'tombstone').map(event => event.value),
      nextCursor,
      hasMore,
    })
  } catch (error) {
    next(error)
  }
})

export default router
