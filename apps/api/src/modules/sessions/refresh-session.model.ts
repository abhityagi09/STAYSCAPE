import { Schema, model, type Types } from 'mongoose';

export const SESSION_REVOKE_REASONS = [
  'ROTATED',
  'LOGOUT',
  'LOGOUT_ALL',
  'USER_REVOKED',
  'REUSE_DETECTED',
  'PASSWORD_CHANGED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DELETED',
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

export interface RefreshSessionAttrs {
  userId: Types.ObjectId;
  /** SHA-256 of the opaque refresh token. The raw token is never stored. */
  tokenHash: string;
  /** Every rotation of one sign-in shares a family; reuse of an old token revokes the family. */
  tokenFamily: string;
  familyCreatedAt: Date;
  deviceInformation: { userAgent: string | null; label: string };
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: SessionRevokeReason | null;
  createdAt: Date;
}

export type RefreshSessionRecord = RefreshSessionAttrs & { _id: Types.ObjectId };

const refreshSessionSchema = new Schema<RefreshSessionAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    tokenFamily: { type: String, required: true },
    familyCreatedAt: { type: Date, required: true },
    deviceInformation: {
      userAgent: { type: String, default: null, maxlength: 512 },
      label: { type: String, default: 'Unknown device', maxlength: 120 },
    },
    ipAddress: { type: String, default: null, maxlength: 64 },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, enum: [...SESSION_REVOKE_REASONS, null], default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

refreshSessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'uniq_token_hash' });
refreshSessionSchema.index({ tokenFamily: 1, revokedAt: 1 }, { name: 'family_revoked' });
refreshSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 }, { name: 'user_active' });
// Expired sessions are removed automatically by MongoDB's TTL monitor.
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expires' });

export const RefreshSessionModel = model<RefreshSessionAttrs>(
  'RefreshSession',
  refreshSessionSchema,
);
