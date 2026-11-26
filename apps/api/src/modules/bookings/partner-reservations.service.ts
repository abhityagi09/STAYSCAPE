import { Schema, Types, model } from 'mongoose';
import type { PartnerBookingDetailDto } from '@stayscape/shared';
import { AppError, Errors } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import type { AuditService } from '@/modules/audit/audit.service';
import type { PartnerAccessService } from '@/modules/partners/partner-access.service';
import {
  PaymentModel,
  RefundModel,
  type PaymentRecord,
  type RefundRecord,
} from '@/modules/payments/payment.models';
import { UserModel } from '@/modules/users/user.model';
import type { AuthContext } from '@/types/express';
import { toCancellationDto, toItemDto } from './booking.mapper';
import {
  BookingModel,
  CancellationModel,
  type BookingRecord,
  type CancellationRecord,
} from './booking.models';
import type { CancellationsService } from './cancellations.service';

/** Internal, property-only notes on a reservation. Append-only (an audit trail in itself). */
export interface BookingNoteAttrs {
  bookingId: Types.ObjectId;
  hotelId: Types.ObjectId;
  authorId: Types.ObjectId;
  authorName: string;
  body: string;
  createdAt: Date;
}
const bookingNoteSchema = new Schema<BookingNoteAttrs>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 2000 },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
bookingNoteSchema.index({ bookingId: 1, createdAt: 1 }, { name: 'booking_created' });
export const BookingNoteModel = model<BookingNoteAttrs>('BookingNote', bookingNoteSchema);

const name = (u: { firstName: string; lastName: string } | undefined) =>
  u ? `${u.firstName} ${u.lastName}` : null;

export class PartnerReservationsService {
  constructor(
    private readonly deps: {
      access: PartnerAccessService;
      audit: AuditService;
      cancellations: CancellationsService;
    },
  ) {}

  private async find(hotelId: string, reference: string): Promise<BookingRecord> {
    const booking = await BookingModel.findOne({
      bookingReference: reference,
      hotelId,
      bookingStatus: { $nin: ['PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'EXPIRED'] },
    }).lean<BookingRecord>();
    if (!booking) throw Errors.notFound('Booking');
    return booking;
  }

  /**
   * Full reservation detail for the property. Payment information is limited to what operations
   * need (status and amounts) — no provider identifiers or customer payment data.
   */
  async detail(
    auth: AuthContext,
    hotelId: string,
    reference: string,
  ): Promise<PartnerBookingDetailDto> {
    await this.deps.access.resolveHotel(auth, hotelId, 'bookings:view');
    const booking = await this.find(hotelId, reference);
    const [payments, refunds, cancellation, notes, staff] = await Promise.all([
      PaymentModel.find({ bookingId: booking._id }).sort({ createdAt: 1 }).lean<PaymentRecord[]>(),
      RefundModel.find({ bookingId: booking._id }).sort({ requestedAt: 1 }).lean<RefundRecord[]>(),
      CancellationModel.findOne({ bookingId: booking._id }).lean<CancellationRecord>(),
      BookingNoteModel.find({ bookingId: booking._id })
        .sort({ createdAt: 1 })
        .lean<Array<BookingNoteAttrs & { _id: Types.ObjectId }>>(),
      UserModel.find(
        { _id: { $in: [booking.checkedInBy, booking.checkedOutBy].filter(Boolean) } },
        { firstName: 1, lastName: 1 },
      ).lean<Array<{ _id: Types.ObjectId; firstName: string; lastName: string }>>(),
    ]);
    const who = (id: Types.ObjectId | null | undefined) =>
      id ? name(staff.find((u) => u._id.equals(id))) : null;
    const summary = (await this.deps.cancellations.listForPartnerByIds([booking]))[0]!;
    return {
      ...summary,
      items: booking.bookingItems.map(toItemDto),
      guestDetails: booking.guestDetails,
      price: booking.priceSnapshot,
      payments: payments.map((p) => ({
        status: p.status,
        amountMinor: p.amountMinor,
        refundedMinor: p.refundedMinor,
        currency: p.currency,
        createdAt: p.createdAt.toISOString(),
      })),
      refunds: refunds.map((r) => ({
        status: r.status,
        amountMinor: r.amountMinor,
        currency: r.currency,
        reason: r.reason,
        requestedAt: r.requestedAt.toISOString(),
      })),
      cancellation: cancellation ? toCancellationDto(cancellation) : null,
      roomAssignments: (booking.roomAssignments ?? []).map((a) => ({
        roomTypeId: a.roomTypeId.toString(),
        roomNumbers: a.roomNumbers,
      })),
      notes: notes.map((n) => ({
        id: n._id.toString(),
        authorName: n.authorName,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
      })),
      checkedInAt: booking.checkedInAt?.toISOString() ?? null,
      checkedInBy: who(booking.checkedInBy),
      checkedOutAt: booking.checkedOutAt?.toISOString() ?? null,
      checkedOutBy: who(booking.checkedOutBy),
      timeline: booking.statusHistory.map((e) => ({
        at: e.at.toISOString(),
        type: e.status,
        label: e.note ?? e.status,
      })),
    };
  }

  async addNote(
    auth: AuthContext,
    hotelId: string,
    reference: string,
    body: string,
    context: RequestContext,
  ): Promise<PartnerBookingDetailDto> {
    await this.deps.access.resolveHotel(auth, hotelId, 'bookings:notes');
    const booking = await this.find(hotelId, reference);
    const author = await UserModel.findById(auth.userId, { firstName: 1, lastName: 1 }).lean<{
      firstName: string;
      lastName: string;
    }>();
    const note = await BookingNoteModel.create({
      bookingId: booking._id,
      hotelId: booking.hotelId,
      authorId: new Types.ObjectId(auth.userId),
      authorName: name(author ?? undefined) ?? 'Staff',
      body,
    });
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'booking.note_added',
      entityType: 'Booking',
      entityId: booking._id.toString(),
      metadata: { noteId: note._id.toString() },
      context,
    });
    return this.detail(auth, hotelId, reference);
  }

  /** Assign physical room numbers; counts may not exceed the rooms booked for each category. */
  async assignRooms(
    auth: AuthContext,
    hotelId: string,
    reference: string,
    assignments: Array<{ roomTypeId: string; roomNumbers: string[] }>,
    context: RequestContext,
  ): Promise<PartnerBookingDetailDto> {
    await this.deps.access.resolveHotel(auth, hotelId, 'bookings:check-in');
    const booking = await this.find(hotelId, reference);
    if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.bookingStatus))
      throw new AppError(
        409,
        'INVALID_STATE',
        'Rooms can be assigned to confirmed or checked-in reservations only.',
      );
    for (const a of assignments) {
      const item = booking.bookingItems.find((i) => i.roomTypeId.toString() === a.roomTypeId);
      if (!item) throw Errors.badRequest('That room category is not part of this booking.');
      if (a.roomNumbers.length > item.rooms)
        throw Errors.badRequest(`Only ${item.rooms} room(s) of ${item.roomTypeName} were booked.`);
    }
    const next = assignments.map((a) => ({
      roomTypeId: new Types.ObjectId(a.roomTypeId),
      roomNumbers: a.roomNumbers,
    }));
    await BookingModel.updateOne({ _id: booking._id }, { $set: { roomAssignments: next } });
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'booking.rooms_assigned',
      entityType: 'Booking',
      entityId: booking._id.toString(),
      metadata: { before: booking.roomAssignments ?? [], after: assignments },
      context,
    });
    return this.detail(auth, hotelId, reference);
  }
}
