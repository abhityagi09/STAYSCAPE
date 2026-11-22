import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { normalizeApiError } from './api/errors';

/**
 * Copy server-side field errors onto the form. Returns the message to show at form level
 * when the error is not attributable to specific fields.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: ReadonlyArray<Path<T>>,
): string | null {
  const normalized = normalizeApiError(error);
  let mapped = false;
  for (const field of fields) {
    const message = normalized.firstFieldError(field);
    if (message) {
      setError(field, { type: 'server', message });
      mapped = true;
    }
  }
  return mapped ? null : normalized.message;
}

/** Only allow same-origin relative redirects (prevents open-redirects via ?redirect=). */
export function safeRedirect(target: string | null | undefined, fallback: string): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\'))
    return fallback;
  return target;
}
