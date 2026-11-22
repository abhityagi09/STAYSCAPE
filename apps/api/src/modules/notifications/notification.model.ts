import { Schema, model, type Types } from 'mongoose';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationDeliveryStatus,
  type NotificationType,
} from '@stayscape/shared';

export interface NotificationAttrs {
  userId: Types.ObjectId;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  body: string;
  deliveryStatus: NotificationDeliveryStatus;
  deliveredAt: Date | null;
  failureReason: string | null;
  readAt: Date | null;
  resource: { type: string; id: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationRecord = NotificationAttrs & { _id: Types.ObjectId };

const notificationSchema = new Schema<NotificationAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, required: true, default: 'IN_APP' },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, required: true, maxlength: 2000 },
    deliveryStatus: {
      type: String,
      enum: NOTIFICATION_DELIVERY_STATUSES,
      required: true,
      default: 'PENDING',
    },
    deliveredAt: { type: Date, default: null },
    failureReason: { type: String, default: null, maxlength: 500 },
    readAt: { type: Date, default: null },
    resource: {
      type: new Schema(
        { type: { type: String, required: true }, id: { type: String, required: true } },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true, versionKey: false },
);

notificationSchema.index({ userId: 1, createdAt: -1 }, { name: 'user_created' });
notificationSchema.index({ userId: 1, readAt: 1 }, { name: 'user_unread' });
notificationSchema.index({ channel: 1, deliveryStatus: 1 }, { name: 'delivery_queue' });

export const NotificationModel = model<NotificationAttrs>('Notification', notificationSchema);
