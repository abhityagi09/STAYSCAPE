import { Schema, model, type Types } from 'mongoose';
import {
  TICKET_CATEGORIES,
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketChannel,
  type TicketPriority,
  type TicketStatus,
} from '@stayscape/shared';

export interface SupportTicketAttrs {
  ticketNumber: string;
  customerId: Types.ObjectId;
  bookingId: Types.ObjectId | null;
  bookingReference: string | null;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  statusHistory: Array<{ status: TicketStatus; at: Date; by: Types.ObjectId | null }>;
  lastMessageAt: Date;
  /** Phase 4 agent console. */
  priority: TicketPriority;
  assigneeId: Types.ObjectId | null;
  hotelId: Types.ObjectId | null;
  partnerId: Types.ObjectId | null;
  /** When true, the property linked to the booking can see the ticket and the PARTNER thread. */
  partnerVisible: boolean;
  escalated: boolean;
  escalationReason: string | null;
  escalatedAt: Date | null;
  /** First agent reply on the CUSTOMER channel (response-time reporting). */
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export type SupportTicketRecord = SupportTicketAttrs & { _id: Types.ObjectId };

const ticketSchema = new Schema<SupportTicketAttrs>(
  {
    ticketNumber: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    bookingReference: { type: String, default: null },
    subject: { type: String, required: true, maxlength: 140 },
    category: { type: String, enum: TICKET_CATEGORIES, required: true },
    status: { type: String, enum: TICKET_STATUSES, default: 'OPEN' },
    statusHistory: { type: Schema.Types.Mixed, default: [] },
    lastMessageAt: { type: Date, required: true },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'NORMAL' },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', default: null },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', default: null },
    partnerVisible: { type: Boolean, default: false },
    escalated: { type: Boolean, default: false },
    escalationReason: { type: String, default: null, maxlength: 500 },
    escalatedAt: { type: Date, default: null },
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    resolution: { type: String, default: null, maxlength: 1000 },
  },
  { timestamps: true, versionKey: false },
);
ticketSchema.index({ ticketNumber: 1 }, { unique: true, name: 'uniq_number' });
ticketSchema.index({ customerId: 1, lastMessageAt: -1 }, { name: 'customer_last_message' });
ticketSchema.index({ status: 1, lastMessageAt: 1 }, { name: 'status_last_message' });
ticketSchema.index({ assigneeId: 1, status: 1 }, { name: 'assignee_status' });
ticketSchema.index({ hotelId: 1, partnerVisible: 1, lastMessageAt: -1 }, { name: 'hotel_shared' });
ticketSchema.index({ createdAt: -1 }, { name: 'created' });
export const SupportTicketModel = model<SupportTicketAttrs>('SupportTicket', ticketSchema);

export interface TicketMessageAttrs {
  ticketId: Types.ObjectId;
  authorId: Types.ObjectId | null;
  authorRole: 'CUSTOMER' | 'AGENT' | 'PARTNER' | 'SYSTEM';
  /** Absent on Phase 3 rows, which are all customer-visible. */
  channel: TicketChannel;
  authorName: string;
  body: string;
  attachmentIds: Types.ObjectId[];
  createdAt: Date;
}
export type TicketMessageRecord = TicketMessageAttrs & { _id: Types.ObjectId };

const messageSchema = new Schema<TicketMessageAttrs>(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'SupportTicket', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    authorRole: { type: String, enum: ['CUSTOMER', 'AGENT', 'PARTNER', 'SYSTEM'], required: true },
    channel: { type: String, enum: TICKET_CHANNELS, default: 'CUSTOMER' },
    authorName: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 5000 },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
messageSchema.index({ ticketId: 1, createdAt: 1 }, { name: 'ticket_created' });
export const TicketMessageModel = model<TicketMessageAttrs>('TicketMessage', messageSchema);
