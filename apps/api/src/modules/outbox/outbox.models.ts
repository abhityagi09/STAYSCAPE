import { Schema, model, type Types } from 'mongoose';

/**
 * Transactional outbox. Domain services insert events in the SAME transaction as the state change,
 * so a committed booking can never be missing its notification (and a rolled-back one never
 * produces one). A dispatcher moves pending events onto BullMQ; `eventId` doubles as the BullMQ
 * job id, so a re-dispatched event is never processed twice.
 */
export const OUTBOX_STATUSES = ['PENDING', 'DISPATCHING', 'DISPATCHED', 'FAILED'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export interface OutboxEventAttrs {
  eventId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  availableAt: Date;
  lockedUntil: Date | null;
  lastError: string | null;
  dispatchedAt: Date | null;
  createdAt: Date;
}
export type OutboxEventRecord = OutboxEventAttrs & { _id: Types.ObjectId };

const outboxSchema = new Schema<OutboxEventAttrs>(
  {
    eventId: { type: String, required: true, maxlength: 200 },
    type: { type: String, required: true, maxlength: 80 },
    aggregateType: { type: String, required: true },
    aggregateId: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: OUTBOX_STATUSES, default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    availableAt: { type: Date, default: () => new Date() },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 1000 },
    dispatchedAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
outboxSchema.index({ eventId: 1 }, { unique: true, name: 'uniq_event' });
outboxSchema.index({ status: 1, availableAt: 1 }, { name: 'status_available' });
outboxSchema.index({ aggregateType: 1, aggregateId: 1, createdAt: 1 }, { name: 'aggregate' });
export const OutboxEventModel = model<OutboxEventAttrs>('OutboxEvent', outboxSchema);

/** Delivery log per (event, channel, recipient): duplicate suppression + failed-delivery inspection. */
export interface NotificationDeliveryAttrs {
  dedupeKey: string;
  eventId: string;
  userId: Types.ObjectId | null;
  channel: 'IN_APP' | 'EMAIL';
  template: string;
  recipient: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  attempts: number;
  lastError: string | null;
  skippedReason: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type NotificationDeliveryRecord = NotificationDeliveryAttrs & { _id: Types.ObjectId };

const deliverySchema = new Schema<NotificationDeliveryAttrs>(
  {
    dedupeKey: { type: String, required: true, maxlength: 300 },
    eventId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    channel: { type: String, enum: ['IN_APP', 'EMAIL'], required: true },
    template: { type: String, required: true },
    recipient: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'SENT', 'FAILED', 'SKIPPED'], default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null, maxlength: 1000 },
    skippedReason: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
deliverySchema.index({ dedupeKey: 1 }, { unique: true, name: 'uniq_dedupe' });
deliverySchema.index({ status: 1, updatedAt: -1 }, { name: 'status_updated' });
deliverySchema.index({ eventId: 1 }, { name: 'event' });
export const NotificationDeliveryModel = model<NotificationDeliveryAttrs>(
  'NotificationDelivery',
  deliverySchema,
);
