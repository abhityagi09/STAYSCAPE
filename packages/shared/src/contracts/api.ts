/**
 * Central API envelope conventions.
 *
 * Success: { success: true, data, meta? }
 * Failure: { success: false, error: { code, message, details?, requestId? } }
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'SESSION_REVOKED',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_REUSED',
  'CSRF_INVALID',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DEACTIVATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'EMAIL_TAKEN',
  'VERIFICATION_TOKEN_INVALID',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface FieldErrors {
  [field: string]: string[];
}

export interface ApiErrorDetails {
  fieldErrors?: FieldErrors;
  formErrors?: string[];
  [key: string]: unknown;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: ApiErrorDetails;
    requestId?: string;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<TData, TMeta = undefined> {
  success: true;
  data: TData;
  meta?: TMeta;
}

export type ApiResponse<TData, TMeta = undefined> = ApiSuccess<TData, TMeta> | ApiErrorBody;

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

export const API_PREFIX = '/api/v1';

/** Names shared by API and web so cookie/header handling never drifts. */
export const AUTH_COOKIES = {
  refreshToken: 'ss_rt',
  csrfToken: 'ss_csrf',
} as const;

export const CSRF_HEADER = 'x-csrf-token';
export const REQUEST_ID_HEADER = 'x-request-id';
