import type { Request, Response, NextFunction } from 'express'
import { v4 as uuidv4 } from 'uuid'

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || uuidv4()
  req.requestId = id
  res.setHeader('x-request-id', id)
  next()
}
