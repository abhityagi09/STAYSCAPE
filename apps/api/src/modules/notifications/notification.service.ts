import type {
  ListNotificationsQuery,
  NotificationDto,
  NotificationType,
  Paginated,
} from '@stayscape/shared';
import { Errors } from '@/lib/errors';
import { paginated } from '@/lib/http';
import type { Logger } from '@/lib/logger';
import type { NotificationRecord } from './notification.model';
import type { NotificationRepository } from './notification.repository';

export function toNotificationDto(record: NotificationRecord): NotificationDto {
  return {
    id: record._id.toString(),
    type: record.type,
    channel: record.channel,
    title: record.title,
    body: record.body,
    deliveryStatus: record.deliveryStatus,
    readAt: record.readAt ? record.readAt.toISOString() : null,
    resource: record.resource ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Persist an in-app notification. Storing it in the user's inbox *is* the delivery for
   * the IN_APP channel, so it is recorded as DELIVERED. External channels (email/SMS/push)
   * start as PENDING and are updated by their delivery workers in later phases.
   */
  async notifyInApp(params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    resource?: { type: string; id: string };
  }): Promise<void> {
    try {
      await this.repository.create({
        userId: params.userId,
        type: params.type,
        channel: 'IN_APP',
        title: params.title,
        body: params.body,
        deliveryStatus: 'DELIVERED',
        deliveredAt: new Date(),
        failureReason: null,
        readAt: null,
        resource: params.resource ?? null,
      });
    } catch (error) {
      this.logger.error({ err: error, type: params.type }, 'Failed to create notification');
    }
  }

  async list(userId: string, query: ListNotificationsQuery): Promise<Paginated<NotificationDto>> {
    const { items, total } = await this.repository.listForUser(userId, query);
    return paginated(items.map(toNotificationDto), query.page, query.limit, total);
  }

  unreadCount(userId: string): Promise<number> {
    return this.repository.countUnread(userId);
  }

  async markRead(userId: string, notificationId: string): Promise<NotificationDto> {
    const record = await this.repository.markRead(userId, notificationId);
    if (!record) throw Errors.notFound('Notification');
    return toNotificationDto(record);
  }

  markAllRead(userId: string): Promise<number> {
    return this.repository.markAllRead(userId);
  }
}
