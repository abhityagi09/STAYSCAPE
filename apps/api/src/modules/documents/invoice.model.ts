import { Schema, model, type Types } from 'mongoose';
import type { CurrencyCode } from '@stayscape/shared';

export interface PartyDetails {
  name: string;
  address: string;
  taxId: string | null;
  email: string | null;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitMinor: number;
  amountMinor: number;
}

export interface InvoiceAttrs {
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  invoiceNumber: string;
  issuerMode: 'PLATFORM' | 'PROPERTY';
  issuerDetails: PartyDetails;
  customerDetails: PartyDetails;
  lineItems: InvoiceLine[];
  taxBreakdown: Array<{ label: string; amountMinor: number }>;
  feeBreakdown: Array<{ label: string; amountMinor: number }>;
  discountMinor: number;
  totalMinor: number;
  currency: CurrencyCode;
  issuedAt: Date;
  /** Private-storage key of the generated PDF. */
  documentReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export type InvoiceRecord = InvoiceAttrs & { _id: Types.ObjectId };

const party = {
  name: String,
  address: String,
  taxId: { type: String, default: null },
  email: { type: String, default: null },
};
const invoiceSchema = new Schema<InvoiceAttrs>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    invoiceNumber: { type: String, required: true },
    issuerMode: { type: String, enum: ['PLATFORM', 'PROPERTY'], required: true },
    issuerDetails: party,
    customerDetails: party,
    lineItems: { type: Schema.Types.Mixed, default: [] },
    taxBreakdown: { type: Schema.Types.Mixed, default: [] },
    feeBreakdown: { type: Schema.Types.Mixed, default: [] },
    discountMinor: { type: Number, default: 0 },
    totalMinor: { type: Number, required: true },
    currency: { type: String, required: true },
    issuedAt: { type: Date, required: true },
    documentReference: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);
invoiceSchema.index({ bookingId: 1 }, { unique: true, name: 'uniq_booking' });
invoiceSchema.index({ invoiceNumber: 1 }, { unique: true, name: 'uniq_number' });
export const InvoiceModel = model<InvoiceAttrs>('Invoice', invoiceSchema);
