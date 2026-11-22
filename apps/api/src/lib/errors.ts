import type { ApiErrorDetails, ErrorCode } from '@stayscape/shared';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ApiErrorDetails,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  badRequest: (message = 'The request is invalid.', details?: ApiErrorDetails) =>
    new AppError(400, 'BAD_REQUEST', message, details),
  validation: (details: ApiErrorDetails, message = 'Some fields are invalid.') =>
    new AppError(422, 'VALIDATION_ERROR', message, details),
  unauthorized: (code: ErrorCode = 'AUTH_REQUIRED', message = 'Authentication is required.') =>
    new AppError(401, code, message),
  invalidCredentials: () =>
    new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'),
  forbidden: (message = 'You do not have permission to perform this action.') =>
    new AppError(403, 'FORBIDDEN', message),
  notFound: (resource = 'Resource') => new AppError(404, 'NOT_FOUND', `${resource} not found.`),
  conflict: (code: ErrorCode, message: string) => new AppError(409, code, message),
  tooLarge: (message = 'The request payload is too large.') =>
    new AppError(413, 'PAYLOAD_TOO_LARGE', message),
  unsupportedMedia: (message: string) => new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message),
  unavailable: (message = 'The service is temporarily unavailable.') =>
    new AppError(503, 'SERVICE_UNAVAILABLE', message),
};

export function isMongoDuplicateKey(
  error: unknown,
): error is { code: 11000; keyPattern?: Record<string, unknown> } {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
  );
}
