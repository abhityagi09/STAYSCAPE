import { createHash, randomBytes } from 'node:crypto';
import { Schema, Types, model } from 'mongoose';
import type { SharedTripDto, TripDto, TripItemDto, TripRole } from '@stayscape/shared';
import { AppError, Errors } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import type { AuditService } from '@/modules/audit/audit.service';
import { BookingModel, type BookingRecord } from '@/modules/bookings/booking.models';
import { HotelModel } from '@/modules/hotels/hotel.model';
import type { NotificationService } from '@/modules/notifications/notification.service';
import { UserModel } from '@/modules/users/user.model';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const MAX_MEMBERS = 12;
const MAX_ITEMS = 200;
const INVITE_TTL_MS = 14 * 86_400_000;

interface TripItem {
  _id: Types.ObjectId;
  kind: 'HOTEL' | 'BOOKING' | 'NOTE';
  title: string;
  note: string;
  date: string | null;
  hotelId: Types.ObjectId | null;
  bookingId: Types.ObjectId | null;
  addedBy: Types.ObjectId;
  createdAt: Date;
}
interface TripAttrs {
  ownerId: Types.ObjectId;
  title: string;
  description: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  collaborators: Array<{ userId: Types.ObjectId; role: 'EDITOR' | 'VIEWER'; addedAt: Date }>;
  invitations: Array<{
    tokenHash: string;
    email: string;
    role: 'EDITOR' | 'VIEWER';
    expiresAt: Date;
  }>;
  items: TripItem[];
  shareTokenHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}
type TripRecord = TripAttrs & { _id: Types.ObjectId };
const tripSchema = new Schema<TripAttrs>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 1000 },
    destination: { type: String, default: '', maxlength: 100 },
    startDate: { type: String, default: null },
    endDate: { type: String, default: null },
    collaborators: {
      type: [{ userId: Schema.Types.ObjectId, role: String, addedAt: Date, _id: false }],
      default: [],
    },
    invitations: {
      type: [{ tokenHash: String, email: String, role: String, expiresAt: Date, _id: false }],
      default: [],
    },
    items: { type: Schema.Types.Mixed, default: [] },
    shareTokenHash: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);
tripSchema.index({ ownerId: 1, updatedAt: -1 }, { name: 'owner' });
tripSchema.index({ 'collaborators.userId': 1, updatedAt: -1 }, { name: 'collaborator' });
tripSchema.index({ 'invitations.tokenHash': 1 }, { sparse: true, name: 'invite_token' });
tripSchema.index(
  { shareTokenHash: 1 },
  {
    unique: true,
    partialFilterExpression: { shareTokenHash: { $type: 'string' } },
    name: 'uniq_share',
  },
);
export const TripModel = model<TripAttrs>('Trip', tripSchema);

/**
 * TripSpace: plans shared between people. Owners invite by email (single-use, expiring tokens);
 * EDITORs add and remove items, VIEWERs read. Members see each other's names only. A booking added
 * to a trip shows hotel, dates and status only — never price, payment or guest details — and only
 * the booking's own customer can add it. Read-only share links expose hotels, dates and titles.
 */
export class TripsService {
  constructor(private readonly deps: { audit: AuditService; notifications: NotificationService }) {}

  private roleOf(t: TripRecord, userId: string): TripRole | null {
    if (t.ownerId.equals(userId)) return 'OWNER';
    return t.collaborators.find((c) => c.userId.equals(userId))?.role ?? null;
  }

  private async trip(
    userId: string,
    id: string,
    need: TripRole = 'VIEWER',
  ): Promise<{ trip: TripRecord; role: TripRole }> {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Trip');
    const trip = await TripModel.findById(id).lean<TripRecord>();
    const role = trip ? this.roleOf(trip, userId) : null;
    // Non-members get "not found", never "forbidden": a trip's existence is private.
    if (!trip || !role) throw Errors.notFound('Trip');
    const rank = { VIEWER: 0, EDITOR: 1, OWNER: 2 } as const;
    if (rank[role] < rank[need])
      throw Errors.forbidden(
        need === 'OWNER'
          ? 'Only the trip owner can do this.'
          : 'You can view this trip but not edit it.',
      );
    return { trip, role };
  }

  private async items(t: TripRecord): Promise<TripItemDto[]> {
    const [hotels, bookings, people] = await Promise.all([
      HotelModel.find(
        { _id: { $in: t.items.map((i) => i.hotelId).filter(Boolean) } },
        { name: 1, slug: 1, city: 1 },
      ).lean<Array<{ _id: Types.ObjectId; name: string; slug: string; city: string }>>(),
      BookingModel.find(
        { _id: { $in: t.items.map((i) => i.bookingId).filter(Boolean) } },
        {
          bookingReference: 1,
          checkInLocalDate: 1,
          checkOutLocalDate: 1,
          bookingStatus: 1,
          hotelId: 1,
        },
      ).lean<BookingRecord[]>(),
      UserModel.find({ _id: { $in: t.items.map((i) => i.addedBy) } }, { firstName: 1 }).lean<
        Array<{ _id: Types.ObjectId; firstName: string }>
      >(),
    ]);
    return t.items.map((i) => {
      const h = i.hotelId ? hotels.find((x) => x._id.equals(i.hotelId!)) : undefined;
      const b = i.bookingId ? bookings.find((x) => x._id.equals(i.bookingId!)) : undefined;
      return {
        id: i._id.toString(),
        kind: i.kind,
        title: i.title,
        note: i.note,
        date: i.date,
        hotel: h ? { id: h._id.toString(), name: h.name, slug: h.slug, city: h.city } : null,
        booking: b
          ? {
              reference: b.bookingReference,
              checkIn: b.checkInLocalDate,
              checkOut: b.checkOutLocalDate,
              status: b.bookingStatus,
            }
          : null,
        addedBy: people.find((p) => p._id.equals(i.addedBy))?.firstName ?? 'Someone',
        createdAt: new Date(i.createdAt).toISOString(),
      };
    });
  }

  private async dto(t: TripRecord, userId: string): Promise<TripDto> {
    const ids = [t.ownerId, ...t.collaborators.map((c) => c.userId)];
    const users = await UserModel.find({ _id: { $in: ids } }, { firstName: 1, lastName: 1 }).lean<
      Array<{ _id: Types.ObjectId; firstName: string; lastName: string }>
    >();
    const name = (id: Types.ObjectId) => {
      const u = users.find((x) => x._id.equals(id));
      return u ? `${u.firstName} ${u.lastName.charAt(0)}.` : 'Former member';
    };
    const myRole = this.roleOf(t, userId)!;
    return {
      id: t._id.toString(),
      title: t.title,
      description: t.description,
      destination: t.destination,
      startDate: t.startDate,
      endDate: t.endDate,
      myRole,
      members: [
        { userId: t.ownerId.toString(), name: name(t.ownerId), role: 'OWNER' as TripRole },
        ...t.collaborators.map((c) => ({
          userId: c.userId.toString(),
          name: name(c.userId),
          role: c.role as TripRole,
        })),
      ],
      pendingInvitations:
        myRole === 'OWNER' ? t.invitations.filter((i) => i.expiresAt > new Date()).length : 0,
      shared: Boolean(t.shareTokenHash),
      items: await this.items(t),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async list(userId: string) {
    const trips = await TripModel.find({
      $or: [{ ownerId: userId }, { 'collaborators.userId': userId }],
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean<TripRecord[]>();
    return Promise.all(trips.map((t) => this.dto(t, userId)));
  }

  async get(userId: string, id: string) {
    return this.dto((await this.trip(userId, id)).trip, userId);
  }

  async create(
    userId: string,
    input: Pick<TripAttrs, 'title' | 'description' | 'destination' | 'startDate' | 'endDate'>,
  ) {
    if ((await TripModel.countDocuments({ ownerId: userId })) >= 50)
      throw new AppError(409, 'CONFLICT', 'You can keep up to 50 trips.');
    const t = (await TripModel.create({ ...input, ownerId: userId })).toObject() as TripRecord;
    return this.dto(t, userId);
  }

  async update(
    userId: string,
    id: string,
    input: Pick<TripAttrs, 'title' | 'description' | 'destination' | 'startDate' | 'endDate'>,
  ) {
    const { trip } = await this.trip(userId, id, 'EDITOR');
    const t = (await TripModel.findByIdAndUpdate(
      trip._id,
      { $set: input },
      { new: true },
    ).lean<TripRecord>())!;
    return this.dto(t, userId);
  }

  async remove(userId: string, id: string, context: RequestContext) {
    const { trip } = await this.trip(userId, id, 'OWNER');
    await TripModel.deleteOne({ _id: trip._id });
    await this.deps.audit.record({
      actorId: userId,
      action: 'trip.deleted',
      entityType: 'Trip',
      entityId: id,
      context,
    });
  }

  async addItem(
    userId: string,
    id: string,
    input:
      | { kind: 'HOTEL'; hotelId: string; date: string | null; note: string }
      | { kind: 'BOOKING'; bookingReference: string; note: string }
      | { kind: 'NOTE'; title: string; date: string | null; note: string },
  ) {
    const { trip } = await this.trip(userId, id, 'EDITOR');
    if (trip.items.length >= MAX_ITEMS)
      throw new AppError(409, 'CONFLICT', `A trip can hold up to ${MAX_ITEMS} items.`);
    const base = {
      _id: new Types.ObjectId(),
      addedBy: new Types.ObjectId(userId),
      createdAt: new Date(),
      hotelId: null as Types.ObjectId | null,
      bookingId: null as Types.ObjectId | null,
      note: input.note,
    };
    let item: TripItem;
    if (input.kind === 'HOTEL') {
      const h = await HotelModel.findOne(
        { _id: input.hotelId, publicationStatus: 'PUBLISHED' },
        { name: 1 },
      ).lean<{ _id: Types.ObjectId; name: string }>();
      if (!h)
        throw Errors.validation({ fieldErrors: { hotelId: ['This property is not available'] } });
      item = { ...base, kind: 'HOTEL', title: h.name, date: input.date, hotelId: h._id };
    } else if (input.kind === 'BOOKING') {
      // Only the booking's own customer can attach it (no one can surface someone else's booking).
      const b = await BookingModel.findOne(
        { bookingReference: input.bookingReference, customerId: userId },
        { hotelId: 1, 'hotelSnapshot.name': 1, checkInLocalDate: 1 },
      ).lean<BookingRecord>();
      if (!b)
        throw Errors.validation({
          fieldErrors: { bookingReference: ['No booking with this reference on your account'] },
        });
      if (trip.items.some((i) => i.bookingId?.equals(b._id)))
        throw new AppError(409, 'CONFLICT', 'This booking is already in the trip.');
      item = {
        ...base,
        kind: 'BOOKING',
        title: b.hotelSnapshot.name,
        date: b.checkInLocalDate,
        hotelId: b.hotelId,
        bookingId: b._id,
      };
    } else {
      item = { ...base, kind: 'NOTE', title: input.title, date: input.date };
    }
    const t = (await TripModel.findOneAndUpdate(
      { _id: trip._id, [`items.${MAX_ITEMS - 1}`]: { $exists: false } },
      { $push: { items: item } },
      { new: true },
    ).lean<TripRecord>())!;
    return this.dto(t, userId);
  }

  async removeItem(userId: string, id: string, itemId: string) {
    const { trip } = await this.trip(userId, id, 'EDITOR');
    if (!Types.ObjectId.isValid(itemId) || !trip.items.some((i) => i._id.equals(itemId)))
      throw Errors.notFound('Item');
    const t = (await TripModel.findByIdAndUpdate(
      trip._id,
      { $pull: { items: { _id: new Types.ObjectId(itemId) } } },
      { new: true },
    ).lean<TripRecord>())!;
    return this.dto(t, userId);
  }

  async invite(
    userId: string,
    id: string,
    input: { email: string; role: 'EDITOR' | 'VIEWER' },
    context: RequestContext,
  ) {
    const { trip } = await this.trip(userId, id, 'OWNER');
    const live = trip.invitations.filter((i) => i.expiresAt > new Date());
    if (trip.collaborators.length + live.length >= MAX_MEMBERS)
      throw new AppError(409, 'CONFLICT', `A trip can have up to ${MAX_MEMBERS} people.`);
    const token = randomBytes(32).toString('base64url');
    const email = input.email.toLowerCase();
    await TripModel.updateOne(
      { _id: trip._id },
      {
        $set: {
          invitations: [
            ...live.filter((i) => i.email !== email),
            {
              tokenHash: hash(token),
              email,
              role: input.role,
              expiresAt: new Date(Date.now() + INVITE_TTL_MS),
            },
          ],
        },
      },
    );
    const invitee = await UserModel.findOne({ email }, { _id: 1 }).lean<{ _id: Types.ObjectId }>();
    if (invitee)
      await this.deps.notifications.notifyInApp({
        userId: invitee._id.toString(),
        type: 'TRIP_INVITATION',
        title: 'You were invited to plan a trip',
        body: `“${trip.title}” — open the invitation link you received to join.`,
      });
    await this.deps.audit.record({
      actorId: userId,
      action: 'trip.invited',
      entityType: 'Trip',
      entityId: id,
      metadata: { role: input.role },
      context,
    });
    // The link is returned once to the owner to share; only its hash is stored.
    return { token, expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString() };
  }

  async accept(userId: string, token: string) {
    const h = hash(token);
    const trip = await TripModel.findOne({ 'invitations.tokenHash': h }).lean<TripRecord>();
    const inv = trip?.invitations.find((i) => i.tokenHash === h);
    if (!trip || !inv || inv.expiresAt <= new Date()) throw Errors.notFound('Invitation');
    const me = await UserModel.findById(userId, { email: 1 }).lean<{ email: string }>();
    // The invitation is bound to the invited email address.
    if (!me || me.email.toLowerCase() !== inv.email)
      throw Errors.forbidden('This invitation was sent to a different email address.');
    if (this.roleOf(trip, userId)) {
      await TripModel.updateOne({ _id: trip._id }, { $pull: { invitations: { tokenHash: h } } });
      return this.get(userId, trip._id.toString());
    }
    const res = await TripModel.updateOne(
      {
        _id: trip._id,
        'invitations.tokenHash': h,
        'collaborators.userId': { $ne: new Types.ObjectId(userId) },
      },
      {
        $pull: { invitations: { tokenHash: h } },
        $push: {
          collaborators: {
            userId: new Types.ObjectId(userId),
            role: inv.role,
            addedAt: new Date(),
          },
        },
      },
    );
    if (res.modifiedCount !== 1) throw Errors.notFound('Invitation');
    return this.get(userId, trip._id.toString());
  }

  /** Owner removes someone, or a collaborator leaves. */
  async removeMember(userId: string, id: string, memberId: string) {
    const { trip, role } = await this.trip(userId, id);
    if (role !== 'OWNER' && memberId !== userId)
      throw Errors.forbidden('Only the trip owner can remove people.');
    if (!Types.ObjectId.isValid(memberId) || trip.ownerId.equals(memberId))
      throw Errors.badRequest('The owner cannot be removed.');
    await TripModel.updateOne(
      { _id: trip._id },
      { $pull: { collaborators: { userId: new Types.ObjectId(memberId) } } },
    );
  }

  async setSharing(userId: string, id: string, enabled: boolean) {
    const { trip } = await this.trip(userId, id, 'OWNER');
    const token = enabled ? randomBytes(32).toString('base64url') : null;
    await TripModel.updateOne(
      { _id: trip._id },
      { $set: { shareTokenHash: token ? hash(token) : null } },
    );
    return { token };
  }

  /** Public read-only view: titles, dates and hotels only — no notes, people or bookings. */
  async shared(token: string): Promise<SharedTripDto> {
    const trip = await TripModel.findOne({ shareTokenHash: hash(token) }).lean<TripRecord>();
    if (!trip) throw Errors.notFound('Trip');
    const items = (await this.items(trip))
      .filter((i) => i.kind === 'HOTEL')
      .map(({ kind, title, date, hotel }) => ({ kind, title, date, hotel }));
    return {
      title: trip.title,
      description: trip.description,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      items,
    };
  }
}
