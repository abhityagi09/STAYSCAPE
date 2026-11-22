import { Schema, model, type Types } from 'mongoose';
import { VERIFICATION_PURPOSES, type VerificationPurpose } from '@stayscape/shared';

export interface VerificationTokenAttrs {
  userId: Types.ObjectId;
  purpose: VerificationPurpose;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

const verificationTokenSchema = new Schema<VerificationTokenAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: VERIFICATION_PURPOSES, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

verificationTokenSchema.index({ tokenHash: 1 }, { unique: true, name: 'uniq_token_hash' });
verificationTokenSchema.index({ userId: 1, purpose: 1, consumedAt: 1 }, { name: 'user_purpose' });
verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expires' });

export const VerificationTokenModel = model<VerificationTokenAttrs>(
  'VerificationToken',
  verificationTokenSchema,
);
