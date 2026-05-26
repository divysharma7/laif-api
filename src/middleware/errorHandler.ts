import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    })
    return
  }

  if (err instanceof ZodError) {
    const details = err.issues.map(i => ({ field: i.path.join('.'), message: i.message }))
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details } })
    return
  }

  logger.error({ err, path: req.path, method: req.method, requestId: req.requestId }, 'Unhandled error')
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
}
