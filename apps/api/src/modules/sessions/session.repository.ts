import { Types, type ClientSession } from 'mongoose';
import {
  RefreshSessionModel,
  type RefreshSessionAttrs,
  type RefreshSessionRecord,
  type SessionRevokeReason,
} from './refresh-session.model';

export type CreateSessionData = Omit<
  RefreshSessionAttrs,
  'createdAt' | 'revokedAt' | 'revokedReason' | 'userId'
> & {
  userId: string;
};

export class SessionRepository {
  async create(data: CreateSessionData): Promise<RefreshSessionRecord> {
    const doc = await RefreshSessionModel.create({
      ...data,
      userId: new Types.ObjectId(data.userId),
    });
    return doc.toObject() as RefreshSessionRecord;
  }

  findByTokenHash(tokenHash: string): Promise<RefreshSessionRecord | null> {
    return RefreshSessionModel.findOne({ tokenHash }).lean<RefreshSessionRecord>().exec();
  }

  /**
   * Atomically claim a live token for rotation. Only one concurrent caller can succeed;
   * everyone else observes it as already revoked.
   */
  claimForRotation(tokenHash: string): Promise<RefreshSessionRecord | null> {
    return RefreshSessionModel.findOneAndUpdate(
      { tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { revokedAt: new Date(), revokedReason: 'ROTATED' satisfies SessionRevokeReason } },
      { new: false },
    )
      .lean<RefreshSessionRecord>()
      .exec();
  }

  async revokeByTokenHash(
    tokenHash: string,
    reason: SessionRevokeReason,
  ): Promise<RefreshSessionRecord | null> {
    return RefreshSessionModel.findOneAndUpdate(
      { tokenHash, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: reason } },
    )
      .lean<RefreshSessionRecord>()
      .exec();
  }

  async revokeFamily(
    tokenFamily: string,
    reason: SessionRevokeReason,
    userId?: string,
  ): Promise<number> {
    const filter: Record<string, unknown> = { tokenFamily, revokedAt: null };
    if (userId) filter.userId = new Types.ObjectId(userId);
    const result = await RefreshSessionModel.updateMany(filter, {
      $set: { revokedAt: new Date(), revokedReason: reason },
    }).exec();
    return result.modifiedCount;
  }

  async revokeAllForUser(
    userId: string,
    reason: SessionRevokeReason,
    options: { exceptFamily?: string; session?: ClientSession } = {},
  ): Promise<number> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId), revokedAt: null };
    if (options.exceptFamily) filter.tokenFamily = { $ne: options.exceptFamily };
    const result = await RefreshSessionModel.updateMany(
      filter,
      { $set: { revokedAt: new Date(), revokedReason: reason } },
      options.session ? { session: options.session } : {},
    ).exec();
    return result.modifiedCount;
  }

  async isFamilyActive(tokenFamily: string, userId: string): Promise<boolean> {
    const found = await RefreshSessionModel.exists({
      tokenFamily,
      userId: new Types.ObjectId(userId),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).exec();
    return Boolean(found);
  }

  listActiveForUser(userId: string): Promise<RefreshSessionRecord[]> {
    return RefreshSessionModel.find({
      userId: new Types.ObjectId(userId),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .lean<RefreshSessionRecord[]>()
      .exec();
  }
}
