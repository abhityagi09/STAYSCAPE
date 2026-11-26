import { Schema, model, type Types } from 'mongoose';
import type { CurrencyCode } from '@stayscape/shared';
import type { CommissionBase, CommissionScope } from './commission';

// ------------------------------------------------------------------ commission rules
export interface CommissionRuleAttrs {
  name: string;
  scope: CommissionScope;
  partnerId: Types.ObjectId | null;
  hotelId: Types.ObjectId | null;
  rateBasisPoints: number;
  fixedMinor: number;
  base: CommissionBase;
  includeFees: boolean;
  promotional: boolean;
  exempt: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  active: boolean;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
export type CommissionRuleRecord = CommissionRuleAttrs & { _id: Types.ObjectId };

const commissionRuleSchema = new Schema<CommissionRuleAttrs>(
  {
    name: { type: String, required: true, maxlength: 120 },
    scope: { type: String, enum: ['GLOBAL', 'PARTNER', 'HOTEL'], required: true },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', default: null },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', default: null },
    rateBasisPoints: { type: Number, required: true, min: 0, max: 10_000 },
    fixedMinor: { type: Number, default: 0, min: 0 },
    base: {
      type: String,
      enum: ['ROOM_SUBTOTAL', 'DISCOUNTED_ROOM_SUBTOTAL'],
      default: 'DISCOUNTED_ROOM_SUBTOTAL',
    },
    includeFees: { type: Boolean, default: false },
    promotional: { type: Boolean, default: false },
    exempt: { type: Boolean, default: false },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);
commissionRuleSchema.index(
  { active: 1, scope: 1, effectiveFrom: -1 },
  { name: 'active_scope_from' },
);
export const CommissionRuleModel = model<CommissionRuleAttrs>(
  'CommissionRule',
  commissionRuleSchema,
);

// ------------------------------------------------------------------ ledger
/**
 * Append-only ledger. Entries are never updated or deleted; corrections are new entries.
 * Accounts (signed amounts, minor units):
 *   CASH               money held for bookings (+ captured, − refunded, − paid out)
 *   PARTNER_PAYABLE    owed to the partner (+ accrued, − refund share, − paid out)
 *   PLATFORM_REVENUE   commission (+ earned, − reversed on refunds)
 *   PROMOTION_EXPENSE  platform-funded coupons (− cost, + reversed on refunds)
 *   UNALLOCATED        captured money not tied to a confirmed stay (duplicate/late payments)
 * Every event's entries sum so that CASH = PARTNER_PAYABLE + PLATFORM_REVENUE + PROMOTION_EXPENSE + UNALLOCATED.
 */
export const LEDGER_ACCOUNTS = [
  'CASH',
  'PARTNER_PAYABLE',
  'PLATFORM_REVENUE',
  'PROMOTION_EXPENSE',
  'UNALLOCATED',
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];
export const LEDGER_EVENTS = [
  'BOOKING_CONFIRMED',
  'REFUND_SUCCEEDED',
  'UNALLOCATED_CAPTURE',
  'SETTLEMENT_PAID',
] as const;
export type LedgerEvent = (typeof LEDGER_EVENTS)[number];

export interface LedgerEntryAttrs {
  entryKey: string;
  event: LedgerEvent;
  account: LedgerAccount;
  amountMinor: number;
  currency: CurrencyCode;
  bookingId: Types.ObjectId | null;
  partnerId: Types.ObjectId | null;
  hotelId: Types.ObjectId | null;
  paymentId: Types.ObjectId | null;
  refundId: Types.ObjectId | null;
  settlementId: Types.ObjectId | null;
  providerReference: string | null;
  description: string;
  occurredAt: Date;
  createdAt: Date;
}
export type LedgerEntryRecord = LedgerEntryAttrs & { _id: Types.ObjectId };

const ledgerSchema = new Schema<LedgerEntryAttrs>(
  {
    entryKey: { type: String, required: true, maxlength: 200 },
    event: { type: String, enum: LEDGER_EVENTS, required: true },
    account: { type: String, enum: LEDGER_ACCOUNTS, required: true },
    amountMinor: {
      type: Number,
      required: true,
      validate: { validator: Number.isSafeInteger, message: 'Integer minor units' },
    },
    currency: { type: String, required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', default: null },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', default: null },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    refundId: { type: Schema.Types.ObjectId, ref: 'Refund', default: null },
    settlementId: { type: Schema.Types.ObjectId, ref: 'Settlement', default: null },
    providerReference: { type: String, default: null, maxlength: 120 },
    description: { type: String, required: true, maxlength: 300 },
    occurredAt: { type: Date, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
// Idempotency: re-recording an event (retries, webhooks) can never duplicate money movements.
ledgerSchema.index({ entryKey: 1 }, { unique: true, name: 'uniq_entry_key' });
ledgerSchema.index({ partnerId: 1, account: 1, occurredAt: 1 }, { name: 'partner_account_time' });
ledgerSchema.index({ account: 1, occurredAt: 1 }, { name: 'account_time' });
ledgerSchema.index({ bookingId: 1 }, { name: 'booking' });
// Ledger rows are immutable: block updates at the model level (defence in depth).
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'replaceOne',
] as const) {
  ledgerSchema.pre(op, function () {
    throw new Error('Ledger entries are append-only');
  });
}
export const LedgerEntryModel = model<LedgerEntryAttrs>('LedgerEntry', ledgerSchema);

// ------------------------------------------------------------------ settlements
export const SETTLEMENT_STATUSES = [
  'PENDING',
  'ELIGIBLE',
  'PROCESSING',
  'PAID',
  'FAILED',
  'ON_HOLD',
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export interface SettlementAttrs {
  reference: string;
  partnerId: Types.ObjectId;
  periodEnd: Date;
  currency: CurrencyCode;
  grossPayableMinor: number;
  adjustmentsMinor: number;
  netPayableMinor: number;
  entryCount: number;
  status: SettlementStatus;
  statusHistory: Array<{
    status: SettlementStatus;
    at: Date;
    by: Types.ObjectId | null;
    note: string | null;
  }>;
  holdReason: string | null;
  failureReason: string | null;
  evidence: {
    method: string;
    providerReference: string;
    paidAt: Date;
    documentKey: string | null;
    recordedBy: Types.ObjectId;
  } | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
export type SettlementRecord = SettlementAttrs & { _id: Types.ObjectId };

const settlementSchema = new Schema<SettlementAttrs>(
  {
    reference: { type: String, required: true },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true },
    periodEnd: { type: Date, required: true },
    currency: { type: String, required: true },
    grossPayableMinor: { type: Number, required: true },
    adjustmentsMinor: { type: Number, required: true },
    netPayableMinor: { type: Number, required: true },
    entryCount: { type: Number, required: true },
    status: { type: String, enum: SETTLEMENT_STATUSES, required: true },
    statusHistory: { type: Schema.Types.Mixed, default: [] },
    holdReason: { type: String, default: null },
    failureReason: { type: String, default: null },
    evidence: { type: Schema.Types.Mixed, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);
settlementSchema.index({ reference: 1 }, { unique: true, name: 'uniq_reference' });
settlementSchema.index({ partnerId: 1, createdAt: -1 }, { name: 'partner_created' });
settlementSchema.index({ status: 1, createdAt: -1 }, { name: 'status_created' });
export const SettlementModel = model<SettlementAttrs>('Settlement', settlementSchema);

/** Which ledger entries a settlement covers. An entry belongs to at most one live settlement. */
export interface SettlementAllocationAttrs {
  entryId: Types.ObjectId;
  settlementId: Types.ObjectId;
  /** Released when the settlement FAILED, so the entries can be settled again. */
  released: boolean;
  /** Unique while live; set to the allocation id when released (keeps the unique index usable). */
  liveKey: string;
}
const allocationSchema = new Schema<SettlementAllocationAttrs>(
  {
    entryId: { type: Schema.Types.ObjectId, ref: 'LedgerEntry', required: true },
    settlementId: { type: Schema.Types.ObjectId, ref: 'Settlement', required: true },
    released: { type: Boolean, default: false },
    liveKey: { type: String, required: true },
  },
  { versionKey: false },
);
allocationSchema.index({ liveKey: 1 }, { unique: true, name: 'uniq_live' });
allocationSchema.index({ settlementId: 1 }, { name: 'settlement' });
allocationSchema.index({ entryId: 1 }, { name: 'entry' });
export const SettlementAllocationModel = model<SettlementAllocationAttrs>(
  'SettlementAllocation',
  allocationSchema,
);
