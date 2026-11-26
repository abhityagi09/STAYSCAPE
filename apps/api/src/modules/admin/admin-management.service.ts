import { Types, type Model } from 'mongoose';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import { paginated } from '@/lib/http';
import type { RequestContext } from '@/lib/request-context';
import type { AuditService } from '@/modules/audit/audit.service';
import { BookingModel, type BookingRecord } from '@/modules/bookings/booking.models';
import type { CacheService } from '@/modules/catalog/cache.service';
import { AmenityModel, DestinationModel } from '@/modules/catalog/catalog.models';
import { HotelModel } from '@/modules/hotels/hotel.model';
import { PaymentModel, RefundModel, type PaymentRecord, type RefundRecord } from '@/modules/payments/payment.models';
import { SupportTicketModel } from '@/modules/support/support.models';
import { UserModel } from '@/modules/users/user.model';
import type { AuthContext } from '@/types/express';
import { BookingEscalationModel, PropertyCategoryModel, type BookingEscalationRecord } from './admin.models';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const utc = (d: string) => new Date(`${d}T00:00:00.000Z`);
const nextDay = (d: string) => new Date(utc(d).getTime() + 86_400_000);
const dateRange = (field: string, from?: string, to?: string) =>
  from || to ? { [field]: { ...(from ? { $gte: utc(from) } : {}), ...(to ? { $lt: nextDay(to) } : {}) } } : {};
const sortOf = (sort: string, amountField: string): Record<string, 1 | -1> =>
  sort === 'oldest' ? { createdAt: 1 } : sort === 'amount_desc' ? { [amountField]: -1 } : sort === 'amount_asc' ? { [amountField]: 1 } : { createdAt: -1 };

type CatalogKind = 'amenity' | 'destination' | 'category';
interface ListBase {
  page: number;
  limit: number;
  q?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort: string;
}

/**
 * Admin CRUD and moderation over customers, the catalogue, bookings, payments and refunds.
 * Permissions are enforced per route; each mutation is audited with before/after values.
 * Sensitive identifiers (provider ids, documents) are only returned to `payments:read` holders.
 */
export class AdminManagementService {
  constructor(private readonly deps: { audit: AuditService; cache: CacheService }) {}

  private record(actorId: string, action: string, entityType: string, entityId: string, before: unknown, after: unknown, context: RequestContext) {
    return this.deps.audit.record({ actorId, action, entityType, entityId, metadata: { before, after }, context });
  }

  // ------------------------------------------------------------------ catalogue
  private model(kind: CatalogKind): Model<Record<string, unknown>> {
    if (kind === 'amenity') return AmenityModel as unknown as Model<Record<string, unknown>>;
    if (kind === 'destination') return DestinationModel as unknown as Model<Record<string, unknown>>;
    return PropertyCategoryModel as unknown as Model<Record<string, unknown>>;
  }

  async listCatalog(kind: CatalogKind, q: { page: number; limit: number; q?: string | undefined; active?: boolean | undefined }) {
    const filter: Record<string, unknown> = {};
    if (q.active !== undefined) filter.active = q.active;
    if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
    const M = this.model(kind);
    const [items, total] = await Promise.all([M.find(filter).sort(kind === 'category' ? { sortOrder: 1, name: 1 } : { name: 1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), M.countDocuments(filter)]);
    return paginated((items as Array<Record<string, unknown> & { _id: Types.ObjectId }>).map(({ _id, ...rest }) => ({ id: _id.toString(), ...rest })), q.page, q.limit, total);
  }

  private toDoc(kind: CatalogKind, input: Record<string, unknown>) {
    if (kind !== 'destination') return input;
    const { latitude, longitude, ...rest } = input as { latitude: number; longitude: number };
    return { ...rest, coordinates: { type: 'Point', coordinates: [longitude, latitude] } };
  }

  async saveCatalog(actorId: string, kind: CatalogKind, id: string | null, input: Record<string, unknown>, context: RequestContext) {
    const M = this.model(kind);
    const doc = this.toDoc(kind, input);
    if (kind === 'category' && Array.isArray(input.amenityCodes) && input.amenityCodes.length) {
      const known = await AmenityModel.countDocuments({ code: { $in: input.amenityCodes } });
      if (known !== new Set(input.amenityCodes as string[]).size) throw Errors.validation({ fieldErrors: { amenityCodes: ['Unknown amenity code'] } });
    }
    try {
      let saved: Record<string, unknown> & { _id: Types.ObjectId };
      let before: unknown = null;
      if (id) {
        if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Item');
        before = await M.findById(id).lean();
        if (!before) throw Errors.notFound('Item');
        // Codes and slugs are referenced by listings and URLs; they cannot be renamed.
        const key = kind === 'destination' ? 'slug' : 'code';
        if ((before as Record<string, unknown>)[key] !== doc[key]) throw Errors.validation({ fieldErrors: { [key]: ['This cannot be changed once created'] } });
        saved = (await M.findByIdAndUpdate(id, { $set: doc }, { new: true, runValidators: true }).lean()) as typeof saved;
      } else {
        saved = (await M.create(doc)).toObject() as typeof saved;
      }
      await this.record(actorId, `catalog.${kind}_${id ? 'updated' : 'created'}`, kind, saved._id.toString(), before, saved, context);
      await this.deps.cache.invalidatePublic();
      const { _id, ...rest } = saved;
      return { id: _id.toString(), ...rest };
    } catch (error) {
      if (isMongoDuplicateKey(error)) throw new AppError(409, 'CONFLICT', 'An item with this code already exists.');
      throw error;
    }
  }

  /** Delete only what nothing references; otherwise deactivate. */
  async deleteCatalog(actorId: string, kind: CatalogKind, id: string, context: RequestContext) {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Item');
    const M = this.model(kind);
    const before = (await M.findById(id).lean()) as (Record<string, unknown> & { code?: string; city?: string }) | null;
    if (!before) throw Errors.notFound('Item');
    if (kind === 'amenity' && (await HotelModel.exists({ amenities: before.code }))) throw new AppError(409, 'CONFLICT', 'Properties use this amenity. Deactivate it instead.');
    if (kind === 'amenity' && (await PropertyCategoryModel.exists({ amenityCodes: before.code }))) throw new AppError(409, 'CONFLICT', 'A category uses this amenity. Remove it there first.');
    await M.deleteOne({ _id: id });
    await this.record(actorId, `catalog.${kind}_deleted`, kind, id, before, null, context);
    await this.deps.cache.invalidatePublic();
  }

  async publicCategories() {
    return this.deps.cache.getOrSet('categories', async () => {
      const rows = await PropertyCategoryModel.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean();
      return rows.map((c) => ({ code: c.code, name: c.name, description: c.description, icon: c.icon, propertyTypes: c.propertyTypes, amenityCodes: c.amenityCodes }));
    });
  }

  // ------------------------------------------------------------------ customers
  async listUsers(q: ListBase & { role?: string | undefined; status?: string | undefined }) {
    const filter: Record<string, unknown> = { ...dateRange('createdAt', q.from, q.to) };
    if (q.role) filter.roles = q.role;
    if (q.status) filter.accountStatus = q.status;
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ email: rx }, { firstName: rx }, { lastName: rx }];
    }
    const [rows, total] = await Promise.all([
      UserModel.find(filter, { firstName: 1, lastName: 1, email: 1, roles: 1, accountStatus: 1, emailVerifiedAt: 1, lastLoginAt: 1, createdAt: 1 }).sort(sortOf(q.sort, 'createdAt')).skip((q.page - 1) * q.limit).limit(q.limit).lean<Array<Record<string, unknown> & { _id: Types.ObjectId }>>(),
      UserModel.countDocuments(filter),
    ]);
    return paginated(rows.map(({ _id, ...u }) => ({ id: _id.toString(), ...u })), q.page, q.limit, total);
  }

  async userDetail(id: string) {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('User');
    const user = await UserModel.findById(id, { firstName: 1, lastName: 1, email: 1, phone: 1, roles: 1, accountStatus: 1, emailVerifiedAt: 1, lastLoginAt: 1, createdAt: 1 }).lean<Record<string, unknown> & { _id: Types.ObjectId }>();
    if (!user) throw Errors.notFound('User');
    const [bookings, spend, tickets, recent] = await Promise.all([
      BookingModel.countDocuments({ customerId: user._id }),
      BookingModel.aggregate<{ _id: string; amount: number }>([{ $match: { customerId: user._id, confirmedAt: { $ne: null } } }, { $group: { _id: '$priceSnapshot.currency', amount: { $sum: '$priceSnapshot.totals.totalMinor' } } }]),
      SupportTicketModel.countDocuments({ customerId: user._id }),
      BookingModel.find({ customerId: user._id }).sort({ createdAt: -1 }).limit(10).lean<BookingRecord[]>(),
    ]);
    const { _id, ...rest } = user;
    return {
      id: _id.toString(),
      ...rest,
      stats: { bookings, tickets, spend: spend.map((s) => ({ currency: s._id, amountMinor: s.amount })) },
      recentBookings: recent.map((b) => this.bookingRow(b)),
    };
  }

  // ------------------------------------------------------------------ bookings, payments, refunds
  private bookingRow(b: BookingRecord, escalation?: BookingEscalationRecord) {
    return {
      reference: b.bookingReference,
      status: b.bookingStatus,
      paymentStatus: b.paymentStatus,
      hotel: { id: b.hotelId.toString(), name: b.hotelSnapshot.name, city: b.hotelSnapshot.city },
      guestName: `${b.guestDetails.primaryGuest.firstName} ${b.guestDetails.primaryGuest.lastName}`,
      checkIn: b.checkInLocalDate,
      checkOut: b.checkOutLocalDate,
      totalMinor: b.priceSnapshot.totals.totalMinor,
      currency: b.priceSnapshot.currency,
      createdAt: b.createdAt.toISOString(),
      escalation: escalation ? { id: escalation._id.toString(), priority: escalation.priority, reason: escalation.reason } : null,
    };
  }

  async listBookings(q: ListBase & { status?: string | undefined; paymentStatus?: string | undefined; hotelId?: string | undefined; escalated?: string | undefined }) {
    const filter: Record<string, unknown> = { ...dateRange('createdAt', q.from, q.to) };
    if (q.status) filter.bookingStatus = q.status;
    if (q.paymentStatus) filter.paymentStatus = q.paymentStatus;
    if (q.hotelId) filter.hotelId = new Types.ObjectId(q.hotelId);
    if (q.escalated) filter._id = { $in: await BookingEscalationModel.distinct('bookingId', { status: 'OPEN' }) };
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ bookingReference: rx }, { 'guestDetails.primaryGuest.lastName': rx }, { 'guestDetails.primaryGuest.email': rx }, { 'hotelSnapshot.name': rx }];
    }
    const [rows, total] = await Promise.all([BookingModel.find(filter).sort(sortOf(q.sort, 'priceSnapshot.totals.totalMinor')).skip((q.page - 1) * q.limit).limit(q.limit).lean<BookingRecord[]>(), BookingModel.countDocuments(filter)]);
    const open = await BookingEscalationModel.find({ bookingId: { $in: rows.map((b) => b._id) }, status: 'OPEN' }).lean<BookingEscalationRecord[]>();
    return paginated(rows.map((b) => this.bookingRow(b, open.find((e) => e.bookingId.equals(b._id)))), q.page, q.limit, total);
  }

  async listPayments(q: ListBase & { status?: string | undefined; exceptions?: string | undefined }) {
    const filter: Record<string, unknown> = { ...dateRange('createdAt', q.from, q.to) };
    if (q.status) filter.status = q.status;
    // Exceptions: failed, or stuck pending for more than 30 minutes, or captured with no confirmed stay.
    if (q.exceptions) {
      const stale = new Date(Date.now() - 30 * 60_000);
      const orphanBookings = await BookingModel.distinct('_id', { bookingStatus: { $in: ['RECONCILIATION_REQUIRED', 'EXPIRED', 'CANCELLED'] }, paymentStatus: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED'] } });
      filter.$or = [{ status: 'FAILED' }, { status: { $in: ['INITIATED', 'PENDING'] }, createdAt: { $lt: stale } }, { status: 'SUCCESS', bookingId: { $in: orphanBookings } }];
    }
    if (q.q) {
      const ids = await BookingModel.distinct('_id', { bookingReference: q.q.toUpperCase() });
      filter.$and = [{ $or: [{ providerOrderId: q.q }, { providerPaymentId: q.q }, { bookingId: { $in: ids } }] }];
    }
    const [rows, total] = await Promise.all([PaymentModel.find(filter).sort(sortOf(q.sort, 'amountMinor')).skip((q.page - 1) * q.limit).limit(q.limit).lean<PaymentRecord[]>(), PaymentModel.countDocuments(filter)]);
    const bookings = await BookingModel.find({ _id: { $in: rows.map((p) => p.bookingId) } }, { bookingReference: 1, bookingStatus: 1 }).lean<Array<{ _id: Types.ObjectId; bookingReference: string; bookingStatus: string }>>();
    return paginated(
      rows.map((p) => {
        const b = bookings.find((x) => x._id.equals(p.bookingId));
        return { id: p._id.toString(), bookingReference: b?.bookingReference ?? null, bookingStatus: b?.bookingStatus ?? null, provider: p.provider, providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId, amountMinor: p.amountMinor, refundedMinor: p.refundedMinor, currency: p.currency, status: p.status, failureReason: p.failureReason, verifiedVia: p.verifiedVia, createdAt: p.createdAt.toISOString(), verifiedAt: p.verifiedAt?.toISOString() ?? null };
      }),
      q.page,
      q.limit,
      total,
    );
  }

  async listRefunds(q: ListBase & { status?: string | undefined }) {
    const filter: Record<string, unknown> = { ...dateRange('createdAt', q.from, q.to) };
    if (q.status) filter.status = q.status;
    const [rows, total] = await Promise.all([RefundModel.find(filter).sort(sortOf(q.sort, 'amountMinor')).skip((q.page - 1) * q.limit).limit(q.limit).lean<RefundRecord[]>(), RefundModel.countDocuments(filter)]);
    const bookings = await BookingModel.find({ _id: { $in: rows.map((r) => r.bookingId) } }, { bookingReference: 1, 'hotelSnapshot.name': 1 }).lean<Array<{ _id: Types.ObjectId; bookingReference: string; hotelSnapshot: { name: string } }>>();
    return paginated(
      rows.map((r) => {
        const b = bookings.find((x) => x._id.equals(r.bookingId));
        return { id: r._id.toString(), bookingReference: b?.bookingReference ?? null, hotelName: b?.hotelSnapshot.name ?? null, amountMinor: r.amountMinor, currency: r.currency, reason: r.reason, source: r.source, status: r.status, attempts: r.attempts, failureReason: r.failureReason, requestedAt: r.requestedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null };
      }),
      q.page,
      q.limit,
      total,
    );
  }

  // ------------------------------------------------------------------ escalations
  async escalate(auth: AuthContext, reference: string, input: { reason: string; priority: 'NORMAL' | 'HIGH' | 'URGENT' }, context: RequestContext) {
    const booking = await BookingModel.findOne({ bookingReference: reference }).lean<BookingRecord>();
    if (!booking) throw Errors.notFound('Booking');
    try {
      const created = await BookingEscalationModel.create({ bookingId: booking._id, bookingReference: booking.bookingReference, hotelId: booking.hotelId, partnerId: booking.partnerId, reason: input.reason, priority: input.priority, status: 'OPEN', openedBy: auth.userId, openKey: booking._id.toString() });
      await this.deps.audit.record({ actorId: auth.userId, action: 'booking.escalated', entityType: 'Booking', entityId: booking._id.toString(), metadata: { before: null, after: { reason: input.reason, priority: input.priority } }, partnerId: booking.partnerId.toString(), hotelId: booking.hotelId.toString(), context });
      return this.escalationDto(created.toObject() as BookingEscalationRecord);
    } catch (error) {
      if (isMongoDuplicateKey(error)) throw new AppError(409, 'CONFLICT', 'This booking already has an open escalation.');
      throw error;
    }
  }

  private escalationDto(e: BookingEscalationRecord) {
    return { id: e._id.toString(), bookingReference: e.bookingReference, hotelId: e.hotelId.toString(), reason: e.reason, priority: e.priority, status: e.status, resolution: e.resolution, openedBy: e.openedBy.toString(), createdAt: e.createdAt.toISOString(), resolvedAt: e.resolvedAt?.toISOString() ?? null };
  }

  async listEscalations(q: { page: number; limit: number; status: 'OPEN' | 'RESOLVED' }) {
    const filter = { status: q.status };
    const [rows, total] = await Promise.all([
      BookingEscalationModel.aggregate<BookingEscalationRecord>([
        { $match: filter },
        { $addFields: { rank: { $indexOfArray: [['NORMAL', 'HIGH', 'URGENT'], '$priority'] } } },
        { $sort: { rank: -1, createdAt: 1 } },
        { $skip: (q.page - 1) * q.limit },
        { $limit: q.limit },
      ]),
      BookingEscalationModel.countDocuments(filter),
    ]);
    return paginated(rows.map((e) => this.escalationDto(e)), q.page, q.limit, total);
  }

  async resolveEscalation(auth: AuthContext, id: string, resolution: string, context: RequestContext) {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Escalation');
    const updated = await BookingEscalationModel.findOneAndUpdate({ _id: id, status: 'OPEN' }, { $set: { status: 'RESOLVED', resolution, resolvedBy: auth.userId, resolvedAt: new Date(), openKey: null } }, { new: true }).lean<BookingEscalationRecord>();
    if (!updated) {
      if (await BookingEscalationModel.exists({ _id: id })) throw new AppError(409, 'INVALID_STATE', 'This escalation is already resolved.');
      throw Errors.notFound('Escalation');
    }
    await this.deps.audit.record({ actorId: auth.userId, action: 'booking.escalation_resolved', entityType: 'Booking', entityId: updated.bookingId.toString(), metadata: { before: { status: 'OPEN' }, after: { status: 'RESOLVED', resolution } }, partnerId: updated.partnerId.toString(), hotelId: updated.hotelId.toString(), context });
    return this.escalationDto(updated);
  }

}
