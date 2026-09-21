/**
 * Typed application errors + one place that converts ANY thrown value into a
 * safe HTTP response.
 *
 * SECURITY: only messages carried by an `AppError` are allowed to reach the
 * browser. Anything else becomes a generic "internal_error" so stack traces,
 * SQL text and GitHub payloads can never leak to a client.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { details?: unknown; cause?: unknown },
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = options?.details;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export const badRequest = (code: string, message: string, details?: unknown): AppError =>
  new AppError(400, code, message, { details });

export const unauthenticated = (message = 'You must sign in to do that.'): AppError =>
  new AppError(401, 'unauthenticated', message);

export const notFound = (code: string, message: string): AppError => new AppError(404, code, message);

export const forbidden = (code: string, message: string): AppError => new AppError(403, code, message);

export const conflict = (code: string, message: string, details?: unknown): AppError =>
  new AppError(409, code, message, { details });

export const unprocessable = (code: string, message: string): AppError =>
  new AppError(422, code, message);

export const rateLimited = (message: string, details?: unknown): AppError =>
  new AppError(429, 'rate_limited', message, { details });

export const serviceUnavailable = (code: string, message: string, details?: unknown): AppError =>
  new AppError(503, code, message, { details });

export const badGateway = (code: string, message: string, details?: unknown): AppError =>
  new AppError(502, code, message, { details });

export const gatewayTimeout = (code: string, message: string, details?: unknown): AppError =>
  new AppError(504, code, message, { details });

export interface HttpErrorBody {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Detect a UNIQUE/PRIMARY KEY constraint violation raised by SQLite.
 *
 * `node:sqlite` reports `errcode` 2067 (SQLITE_CONSTRAINT_UNIQUE) or 1555
 * (SQLITE_CONSTRAINT_PRIMARYKEY). This is how the watches route learns that
 * the DATABASE rejected a duplicate instead of trusting an application check.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const errcode = (error as { errcode?: unknown }).errcode;
  if (errcode === 2067 || errcode === 1555 || errcode === 19) return true;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && (code.startsWith('SQLITE_CONSTRAINT') || code === 'ERR_SQLITE_ERROR')) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && /UNIQUE constraint failed/i.test(message)) return true;
    if (errcode === 2067 || errcode === 1555) return true;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && /UNIQUE constraint failed/i.test(message);
}

/** Any SQLite-level failure (used to answer 503 instead of 500). */
function isSqliteError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && (code.startsWith('SQLITE_') || code === 'ERR_SQLITE_ERROR')) return true;
  return typeof (error as { errcode?: unknown }).errcode === 'number';
}

/** Convert an unknown thrown value into a safe, client-facing error body. */
export function toHttpError(error: unknown): HttpErrorBody {
  if (error instanceof AppError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

  if (isSqliteError(error)) {
    return {
      status: 503,
      code: 'database_unavailable',
      message: 'The database is temporarily unavailable. Please try again in a moment.',
    };
  }

  return {
    status: 500,
    code: 'internal_error',
    message: 'Something went wrong on our side. Please try again.',
  };
}