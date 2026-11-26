import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { IDEMPOTENCY_HEADER } from '@stayscape/shared';
import { AppError } from './errors';

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;

/**
 * Read the client's Idempotency-Key. State-creating operations (holds, bookings, payment orders,
 * cancellations) require one so a retried request returns the original result instead of acting
 * twice.
 */
export function requireIdempotencyKey(req: Request): string {
  const key = req.get(IDEMPOTENCY_HEADER)?.trim();
  if (!key)
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Send an Idempotency-Key header with this request.',
    );
  if (!KEY_PATTERN.test(key))
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'The Idempotency-Key header is malformed.');
  return key;
}

/** Stable fingerprint of a request body (key order independent). */
export function requestFingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

/** A replayed key must carry the same request; anything else is a client bug. */
export function assertSameRequest(stored: string | null | undefined, incoming: string): void {
  if (stored && stored !== incoming) {
    throw new AppError(
      422,
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used for a different request.',
    );
  }
}
