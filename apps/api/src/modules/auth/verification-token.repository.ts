import { Types, type ClientSession } from 'mongoose';
import type { VerificationPurpose } from '@stayscape/shared';
import { VerificationTokenModel, type VerificationTokenAttrs } from './verification-token.model';

export type VerificationTokenRecord = VerificationTokenAttrs & { _id: Types.ObjectId };

export class VerificationTokenRepository {
  async create(
    data: { userId: string; purpose: VerificationPurpose; tokenHash: string; expiresAt: Date },
    session?: ClientSession,
  ): Promise<VerificationTokenRecord> {
    const [doc] = await VerificationTokenModel.create(
      [{ ...data, userId: new Types.ObjectId(data.userId) }],
      session ? { session } : {},
    );
    if (!doc) throw new Error('Token creation failed');
    return doc.toObject() as VerificationTokenRecord;
  }

  /** Mark every outstanding token of this purpose as consumed so only the newest link works. */
  async invalidateOutstanding(
    userId: string,
    purpose: VerificationPurpose,
    session?: ClientSession,
  ): Promise<void> {
    await VerificationTokenModel.updateMany(
      { userId: new Types.ObjectId(userId), purpose, consumedAt: null },
      { $set: { consumedAt: new Date() } },
      session ? { session } : {},
    ).exec();
  }

  /** Atomic single-use consumption: concurrent attempts with the same token cannot both succeed. */
  consume(
    tokenHash: string,
    purpose: VerificationPurpose,
    session?: ClientSession,
  ): Promise<VerificationTokenRecord | null> {
    return VerificationTokenModel.findOneAndUpdate(
      { tokenHash, purpose, consumedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { consumedAt: new Date() } },
      { new: true, ...(session ? { session } : {}) },
    )
      .lean<VerificationTokenRecord>()
      .exec();
  }

  findLatestOutstanding(
    userId: string,
    purpose: VerificationPurpose,
  ): Promise<VerificationTokenRecord | null> {
    return VerificationTokenModel.findOne({
      userId: new Types.ObjectId(userId),
      purpose,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .lean<VerificationTokenRecord>()
      .exec();
  }
}
