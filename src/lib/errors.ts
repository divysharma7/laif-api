// ── Typed Error Classes ──────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = this.constructor.name
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: { field: string; message: string }[]) {
    super(message, 'VALIDATION_ERROR', 422, details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(reason = 'Authentication required') {
    super(reason, 'UNAUTHORIZED', 401)
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterMs: number = 60000) {
    super(`Rate limit exceeded. Retry after ${retryAfterMs}ms`, 'RATE_LIMITED', 429)
  }
}

// ── User-Facing Messages ─────────────────────────────────────────────────────

const USER_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'The requested item could not be found.',
  UNAUTHORIZED: 'Please sign in to continue.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  RATE_LIMITED: 'Too many requests. Please wait a moment.',
  INTERNAL_ERROR: 'Something went wrong. Please try again later.',
}

export function getUserMessage(code: string): string {
  return USER_ERROR_MESSAGES[code] ?? USER_ERROR_MESSAGES.INTERNAL_ERROR
}

// ── Result Pattern ───────────────────────────────────────────────────────────

export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
