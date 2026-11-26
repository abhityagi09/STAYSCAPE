import { Schema, model, type Types } from 'mongoose';
import {
  PAYMENT_EVENT_PROCESSING_STATUSES,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  type CurrencyCode,
  type PaymentEventProcessingStatus,
  type PaymentProviderName,
  type PaymentStatus,
  type RefundStatus,
} from '@stayscape/shared';

// ------------------------------------------------------------------ Payment
export interface PaymentAttrs {
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  provider: PaymentProviderName;
  providerOrderId: string;
  providerPaymentId: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  status: PaymentStatus;
  refundedMinor: number;
  idempotencyKey: string;
  requestHash: string;
  failureReason: string | null;
  verifiedAt: Date | null;
  /** How success was established: browser signature + provider fetch, webhook, or reconciliation. */
  verifiedVia: 'CHECKOUT' | 'WEBHOOK' | 'RECONCILIATION' | null;
  lastReconciledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type PaymentRecord = PaymentAttrs & { _id: Types.ObjectId };

const paymentSchema = new Schema<PaymentAttrs>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    providerOrderId: { type: String, required: true },
    providerPaymentId: { type: String, default: null },
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'Integer minor units' },
    },
    currency: { type: String, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, required: true },
    refundedMinor: { type: Number, default: 0, min: 0 },
    idempotencyKey: { type: String, required: true, maxlength: 128 },
    requestHash: { type: String, required: true },
    failureReason: { type: String, default: null, maxlength: 500 },
    verifiedAt: { type: Date, default: null },
    verifiedVia: {
      type: String,
      enum: ['CHECKOUT', 'WEBHOOK', 'RECONCILIATION', null],
      default: null,
    },
    lastReconciledAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
paymentSchema.index(
  { provider: 1, providerOrderId: 1 },
  { unique: true, name: 'uniq_provider_order' },
);
paymentSchema.index(
  { provider: 1, providerPaymentId: 1 },
  {
    unique: true,
    name: 'uniq_provider_payment',
    partialFilterExpression: { providerPaymentId: { $type: 'string' } },
  },
);
paymentSchema.index(
  { customerId: 1, idempotencyKey: 1 },
  { unique: true, name: 'uniq_customer_idempotency' },
);
paymentSchema.index({ bookingId: 1, createdAt: -1 }, { name: 'booking_created' });
paymentSchema.index({ customerId: 1, createdAt: -1 }, { name: 'customer_created' });
paymentSchema.index({ status: 1, createdAt: 1 }, { name: 'status_created' });
export const PaymentModel = model<PaymentAttrs>('Payment', paymentSchema);

// ------------------------------------------------------------------ PaymentEvent (webhooks)
export interface PaymentEventAttrs {
  provider: PaymentProviderName;
  providerEventId: string;
  paymentId: Types.ObjectId | null;
  eventType: string;
  /** SHA-256 of the raw, signature-verified body. */
  payloadReference: string;
  /** Minimal non-sensitive extract used for processing and support. */
  payload: Record<string, unknown>;
  receivedAt: Date;
  processedAt: Date | null;
  processingStatus: PaymentEventProcessingStatus;
  attempts: number;
  failureReason: string | null;
}
export type PaymentEventRecord = PaymentEventAttrs & { _id: Types.ObjectId };

const paymentEventSchema = new Schema<PaymentEventAttrs>(
  {
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    providerEventId: { type: String, required: true, maxlength: 128 },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    eventType: { type: String, required: true, maxlength: 80 },
    payloadReference: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    receivedAt: { type: Date, required: true },
    processedAt: { type: Date, default: null },
    processingStatus: {
      type: String,
      enum: PAYMENT_EVENT_PROCESSING_STATUSES,
      default: 'RECEIVED',
    },
    attempts: { type: Number, default: 0 },
    failureReason: { type: String, default: null, maxlength: 500 },
  },
  { versionKey: false },
);
// Duplicate deliveries of the same provider event are rejected by the database.
paymentEventSchema.index(
  { provider: 1, providerEventId: 1 },
  { unique: true, name: 'uniq_provider_event' },
);
paymentEventSchema.index({ processingStatus: 1, receivedAt: 1 }, { name: 'status_received' });
export const PaymentEventModel = model<PaymentEventAttrs>('PaymentEvent', paymentEventSchema);

// ------------------------------------------------------------------ Refund
export type RefundSource = 'CANCELLATION' | 'ADMIN' | 'CUSTOMER_REQUEST' | 'RECONCILIATION';

export interface RefundAttrs {
  bookingId: Types.ObjectId;
  paymentId: Types.ObjectId;
  customerId: Types.ObjectId;
  amountMinor: number;
  currency: CurrencyCode;
  reason: string;
  source: RefundSource;
  status: RefundStatus;
  providerRefundId: string | null;
  /** One refund per approved operation, e.g. "cancellation:<bookingId>". */
  idempotencyKey: string;
  requestedBy: Types.ObjectId | null;
  decidedBy: Types.ObjectId | null;
  attempts: number;
  failureReason: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  processingAt: Date | null;
  completedAt: Date | null;
  lastReconciledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type RefundRecord = RefundAttrs & { _id: Types.ObjectId };

const refundSchema = new Schema<RefundAttrs>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'Integer minor units' },
    },
    currency: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    source: {
      type: String,
      enum: ['CANCELLATION', 'ADMIN', 'CUSTOMER_REQUEST', 'RECONCILIATION'],
      required: true,
    },
    status: { type: String, enum: REFUND_STATUSES, required: true },
    providerRefundId: { type: String, default: null },
    idempotencyKey: { type: String, required: true, maxlength: 160 },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    attempts: { type: Number, default: 0 },
    failureReason: { type: String, default: null, maxlength: 500 },
    requestedAt: { type: Date, required: true },
    approvedAt: { type: Date, default: null },
    processingAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastReconciledAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
refundSchema.index({ idempotencyKey: 1 }, { unique: true, name: 'uniq_idempotency' });
refundSchema.index(
  { providerRefundId: 1 },
  {
    unique: true,
    name: 'uniq_provider_refund',
    partialFilterExpression: { providerRefundId: { $type: 'string' } },
  },
);
refundSchema.index({ status: 1, updatedAt: 1 }, { name: 'status_updated' });
refundSchema.index({ customerId: 1, requestedAt: -1 }, { name: 'customer_requested' });
refundSchema.index({ paymentId: 1 }, { name: 'payment' });
refundSchema.index({ bookingId: 1 }, { name: 'booking' });
export const RefundModel = model<RefundAttrs>('Refund', refundSchema);

// ------------------------------------------------------------------ Sandbox gateway state
/**
 * DEVELOPMENT/TEST ONLY. Backing store for the labelled sandbox payment provider so that it
 * behaves like a real gateway (orders, payments, refunds can be fetched for reconciliation).
 * The API refuses to start with the sandbox provider in production.
 */
export interface SandboxRecordAttrs {
  kind: 'ORDER' | 'PAYMENT' | 'REFUND';
  entityId: string;
  orderId: string | null;
  paymentId: string | null;
  amount: number;
  currency: string;
  status: string;
  receipt: string | null;
  notes: Record<string, string>;
  createdAt: Date;
}
const sandboxSchema = new Schema<SandboxRecordAttrs>(
  {
    kind: { type: String, enum: ['ORDER', 'PAYMENT', 'REFUND'], required: true },
    entityId: { type: String, required: true },
    orderId: { type: String, default: null },
    paymentId: { type: String, default: null },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    status: { type: String, required: true },
    receipt: { type: String, default: null },
    notes: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
sandboxSchema.index({ entityId: 1 }, { unique: true, name: 'uniq_entity' });
sandboxSchema.index({ orderId: 1, kind: 1 }, { name: 'order_kind' });
sandboxSchema.index({ paymentId: 1, kind: 1 }, { name: 'payment_kind' });
export const SandboxRecordModel = model<SandboxRecordAttrs>('SandboxGatewayRecord', sandboxSchema);
