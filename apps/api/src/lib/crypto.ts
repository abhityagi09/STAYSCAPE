import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe, high-entropy opaque token (default 256 bits). */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256 is appropriate for hashing *high-entropy random* tokens before storage.
 * (Passwords use Argon2id — see password.ts.)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
