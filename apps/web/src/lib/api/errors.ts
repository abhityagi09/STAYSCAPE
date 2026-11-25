import { isAxiosError, isCancel } from 'axios';
import type { ApiErrorBody, ApiErrorDetails, ErrorCode, FieldErrors } from '@stayscape/shared';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELLED' | 'UNKNOWN';

/** One error shape for every failed request, whatever went wrong. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: ClientErrorCode,
    public readonly fieldErrors: FieldErrors = {},
    public readonly requestId?: string,
    public readonly details: ApiErrorDetails = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  get isNetworkError() {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }

  firstFieldError(field: string): string | undefined {
    return this.fieldErrors[field]?.[0];
  }
}

function isErrorBody(data: unknown): data is ApiErrorBody {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { success?: unknown }).success === false &&
    'error' in data
  );
}

export function normalizeApiError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  if (isCancel(error)) return new ApiClientError('The request was cancelled.', 0, 'CANCELLED');
  if (isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ApiClientError(
        'The server took too long to respond. Please try again.',
        0,
        'TIMEOUT',
      );
    }
    if (!error.response) {
      return new ApiClientError(
        'We could not reach STAYSCAPE. Check your connection and try again.',
        0,
        'NETWORK_ERROR',
      );
    }
    const { status, data } = error.response;
    if (isErrorBody(data)) {
      return new ApiClientError(
        data.error.message,
        status,
        data.error.code,
        data.error.details?.fieldErrors ?? {},
        data.error.requestId,
        data.error.details ?? {},
      );
    }
    if (status >= 500)
      return new ApiClientError(
        'The service is temporarily unavailable. Please try again shortly.',
        status,
        'SERVICE_UNAVAILABLE',
      );
    return new ApiClientError('The request could not be completed.', status, 'UNKNOWN');
  }
  return new ApiClientError('Something unexpected happened.', 0, 'UNKNOWN');
}

/** Human-friendly message for any thrown value. */
export function errorMessage(error: unknown): string {
  return normalizeApiError(error).message;
}
