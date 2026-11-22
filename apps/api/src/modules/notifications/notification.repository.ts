import { Types } from 'mongoose';
import {
  NotificationModel,
  type NotificationAttrs,
  type NotificationRecord,
} from './notification.model';

export class NotificationRepository {
  async create(
    data: Omit<NotificationAttrs, 'createdAt' | 'updatedAt' | 'userId'> & { userId: string },
  ): Promise<NotificationRecord> {
    const doc = await NotificationModel.create({
      ...data,
      userId: new Types.ObjectId(data.userId),
    });
    return doc.toObject() as NotificationRecord;
  }

  async listForUser(
    userId: string,
    options: { page: number; limit: number; unreadOnly: boolean },
  ): Promise<{ items: NotificationRecord[]; total: number }> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (options.unreadOnly) filter.readAt = null;
    const [items, total] = await Promise.all([
      NotificationModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((options.page - 1) * options.limit)
        .limit(options.limit)
        .lean<NotificationRecord[]>()
        .exec(),
      NotificationModel.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  countUnread(userId: string): Promise<number> {
    return NotificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      readAt: null,
    }).exec();
  }

  /** Ownership is part of the filter, so another user's notification is indistinguishable from a missing one. */
  markRead(userId: string, notificationId: string): Promise<NotificationRecord | null> {
    if (!Types.ObjectId.isValid(notificationId)) return Promise.resolve(null);
    return NotificationModel.findOneAndUpdate(
      { _id: new Types.ObjectId(notificationId), userId: new Types.ObjectId(userId) },
      [{ $set: { readAt: { $ifNull: ['$readAt', '$$NOW'] } } }],
      { new: true },
    )
      .lean<NotificationRecord>()
      .exec();
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await NotificationModel.updateMany(
      { userId: new Types.ObjectId(userId), readAt: null },
      { $set: { readAt: new Date() } },
    ).exec();
    return result.modifiedCount;
  }
}
