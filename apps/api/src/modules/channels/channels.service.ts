import { randomBytes } from 'node:crypto';
import { Schema, Types, model } from 'mongoose';
import { addDays, dateRange, todayInTimeZone } from '@stayscape/shared';
import type { Config } from '@/config/env';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import type { FieldEncryptor } from '@/lib/field-encryption';
import { paginated } from '@/lib/http';
import type { Logger } from '@/lib/logger';
import type { RequestContext } from '@/lib/request-context';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import { AVAILABLE_EXPR, DailyInventoryModel } from '@/modules/inventory/inventory.models';
import type { InventoryService } from '@/modules/inventory/inventory.service';
import type { PartnerAccessService } from '@/modules/partners/partner-access.service';
import { RoomTypeModel, type RoomTypeRecord } from '@/modules/rooms/room.models';
import type { AuthContext } from '@/types/express';
import {
  ChannelDeliveryError,
  ChannelPayloadError,
  type ChannelAdapter,
  type NormalizedChannelEvent,
} from './channel.adapter';

// ------------------------------------------------------------------ models
interface ChannelConnectionAttrs {
  hotelId: Types.ObjectId;
  partnerId: Types.ObjectId;
  provider: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED';
  secretEncrypted: string;
  mappings: Array<{ roomTypeId: Types.ObjectId; externalRoomCode: string }>;
  syncStatus: 'NEVER' | 'OK' | 'ERROR';
  lastSyncAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
type ChannelConnectionRecord = ChannelConnectionAttrs & { _id: Types.ObjectId };
const connectionSchema = new Schema<ChannelConnectionAttrs>(
  {
    hotelId: { type: Schema.Types.ObjectId, required: true },
    partnerId: { type: Schema.Types.ObjectId, required: true },
    provider: { type: String, required: true },
    name: { type: String, required: true, maxlength: 80 },
    status: { type: String, enum: ['ACTIVE', 'PAUSED'], default: 'ACTIVE' },
    secretEncrypted: { type: String, required: true },
    mappings: {
      type: [{ roomTypeId: Schema.Types.ObjectId, externalRoomCode: String, _id: false }],
      default: [],
    },
    syncStatus: { type: String, default: 'NEVER' },
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    consecutiveFailures: { type: Number, default: 0 },
    nextSyncAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
connectionSchema.index({ hotelId: 1, provider: 1 }, { unique: true, name: 'uniq_hotel_provider' });
connectionSchema.index({ status: 1, nextSyncAt: 1 }, { name: 'sync_due' });
export const ChannelConnectionModel = model<ChannelConnectionAttrs>(
  'ChannelConnection',
  connectionSchema,
);

type EventStatus = 'PROCESSED' | 'FAILED' | 'CONFLICT' | 'IGNORED';
interface ChannelEventAttrs {
  connectionId: Types.ObjectId;
  hotelId: Types.ObjectId;
  externalEventId: string;
  event: NormalizedChannelEvent;
  status: EventStatus;
  attempts: number;
  error: string | null;
  conflictDates: string[];
  nextAttemptAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
type ChannelEventRecord = ChannelEventAttrs & { _id: Types.ObjectId };
const eventSchema = new Schema<ChannelEventAttrs>(
  {
    connectionId: { type: Schema.Types.ObjectId, required: true },
    hotelId: { type: Schema.Types.ObjectId, required: true },
    externalEventId: { type: String, required: true },
    event: { type: Schema.Types.Mixed, required: true },
    status: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: null },
    conflictDates: { type: [String], default: [] },
    nextAttemptAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
// Idempotency: an event id is processed at most once per connection.
eventSchema.index({ connectionId: 1, externalEventId: 1 }, { unique: true, name: 'uniq_event' });
eventSchema.index({ status: 1, nextAttemptAt: 1 }, { name: 'retry_due' });
eventSchema.index({ connectionId: 1, createdAt: -1 }, { name: 'connection_log' });
export const ChannelEventModel = model<ChannelEventAttrs>('ChannelEvent', eventSchema);

/** Rooms held for a reservation made on an external channel. */
interface ChannelReservationAttrs {
  connectionId: Types.ObjectId;
  externalRef: string;
  roomTypeId: Types.ObjectId;
  nights: string[];
  rooms: number;
  status: 'ACTIVE' | 'CANCELLED';
}
const reservationSchema = new Schema<ChannelReservationAttrs>(
  {
    connectionId: { type: Schema.Types.ObjectId, required: true },
    externalRef: { type: String, required: true },
    roomTypeId: { type: Schema.Types.ObjectId, required: true },
    nights: [String],
    rooms: Number,
    status: { type: String, default: 'ACTIVE' },
  },
  { timestamps: true, versionKey: false },
);
reservationSchema.index({ connectionId: 1, externalRef: 1 }, { unique: true, name: 'uniq_ref' });
export const ChannelReservationModel = model<ChannelReservationAttrs>(
  'ChannelReservation',
  reservationSchema,
);

const MAX_ATTEMPTS = 5;
const SYNC_DAYS = 30;
const backoff = (attempts: number) =>
  new Date(Date.now() + Math.min(6 * 3_600_000, 60_000 * 2 ** attempts));

class ProcessingError extends Error {
  constructor(
    message: string,
    readonly status: EventStatus,
    readonly conflictDates: string[] = [],
  ) {
    super(message);
  }
}

/**
 * Channel-manager integration layer: connections with encrypted webhook secrets, room mappings,
 * signed and idempotent inbound events, conflict (overbooking) detection, an error log, retries
 * with backoff, and scheduled outbound availability sync. Inventory changes reuse the same
 * conditional all-nights-or-none updates as Stayscape's own reservations.
 */
export class ChannelsService {
  private readonly adapters: Map<string, ChannelAdapter>;

  constructor(
    private readonly deps: {
      config: Config;
      access: PartnerAccessService;
      inventory: InventoryService;
      encryptor: FieldEncryptor;
      audit: AuditService;
      logger: Logger;
    },
    adapters: ChannelAdapter[],
  ) {
    this.adapters = new Map(adapters.map((a) => [a.provider, a]));
  }

  private adapter(provider: string) {
    const a = this.adapters.get(provider);
    if (!a)
      throw Errors.validation({
        fieldErrors: { provider: ['This channel manager is not supported'] },
      });
    return a;
  }

  private dto(c: ChannelConnectionRecord) {
    return {
      id: c._id.toString(),
      provider: c.provider,
      verifiedIntegration: this.adapters.get(c.provider)?.verifiedAgainstProvider ?? false,
      name: c.name,
      status: c.status,
      mappings: c.mappings.map((m) => ({
        roomTypeId: m.roomTypeId.toString(),
        externalRoomCode: m.externalRoomCode,
      })),
      syncStatus: c.syncStatus,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      lastError: c.lastError,
      webhookPath: `/api/v1/channels/webhooks/${c._id.toString()}`,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private async connection(
    auth: AuthContext,
    hotelId: string,
    id: string,
    need: 'property:edit' | 'inventory:view' = 'property:edit',
  ) {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, need);
    const c = Types.ObjectId.isValid(id)
      ? await ChannelConnectionModel.findOne({
          _id: id,
          hotelId: hotel._id,
        }).lean<ChannelConnectionRecord>()
      : null;
    if (!c) throw Errors.notFound('Connection');
    return { hotel, c };
  }

  async list(auth: AuthContext, hotelId: string) {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'inventory:view');
    return (
      await ChannelConnectionModel.find({ hotelId: hotel._id }).lean<ChannelConnectionRecord[]>()
    ).map((c) => this.dto(c));
  }

  async create(
    auth: AuthContext,
    hotelId: string,
    input: { provider: string; name: string },
    context: RequestContext,
  ) {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'property:edit');
    this.adapter(input.provider);
    if (input.provider === 'LOCAL_SIMULATOR' && this.deps.config.isProduction)
      throw Errors.validation({
        fieldErrors: { provider: ['The local simulator is for development only'] },
      });
    const secret = randomBytes(32).toString('base64url');
    try {
      const c = (
        await ChannelConnectionModel.create({
          hotelId: hotel._id,
          partnerId: hotel.partnerId,
          provider: input.provider,
          name: input.name,
          secretEncrypted: this.deps.encryptor.encrypt(secret),
        })
      ).toObject() as ChannelConnectionRecord;
      await this.deps.audit.record({
        actorId: auth.userId,
        action: 'channel.connected',
        entityType: 'ChannelConnection',
        entityId: c._id.toString(),
        metadata: { provider: input.provider },
        context,
      });
      // The secret is shown once; only its encrypted form is stored.
      return { ...this.dto(c), webhookSecret: secret };
    } catch (error) {
      if (isMongoDuplicateKey(error))
        throw new AppError(
          409,
          'CONFLICT',
          'This property is already connected to that channel manager.',
        );
      throw error;
    }
  }

  async rotateSecret(auth: AuthContext, hotelId: string, id: string, context: RequestContext) {
    const { c } = await this.connection(auth, hotelId, id);
    const secret = randomBytes(32).toString('base64url');
    await ChannelConnectionModel.updateOne(
      { _id: c._id },
      { $set: { secretEncrypted: this.deps.encryptor.encrypt(secret) } },
    );
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'channel.secret_rotated',
      entityType: 'ChannelConnection',
      entityId: id,
      context,
    });
    return { webhookSecret: secret };
  }

  async update(
    auth: AuthContext,
    hotelId: string,
    id: string,
    input: {
      status?: 'ACTIVE' | 'PAUSED' | undefined;
      mappings?: Array<{ roomTypeId: string; externalRoomCode: string }> | undefined;
    },
    context: RequestContext,
  ) {
    const { hotel, c } = await this.connection(auth, hotelId, id);
    const set: Record<string, unknown> = {};
    if (input.status) set.status = input.status;
    if (input.mappings) {
      const ids = input.mappings.map((m) => m.roomTypeId);
      const rooms = await RoomTypeModel.countDocuments({
        _id: { $in: ids },
        hotelId: hotel._id,
        status: { $ne: 'ARCHIVED' },
      });
      if (rooms !== new Set(ids).size || ids.length !== new Set(ids).size)
        throw Errors.validation({
          fieldErrors: {
            mappings: ['Each mapping needs a different room category of this property'],
          },
        });
      if (new Set(input.mappings.map((m) => m.externalRoomCode)).size !== input.mappings.length)
        throw Errors.validation({
          fieldErrors: { mappings: ['External room codes must be unique'] },
        });
      set.mappings = input.mappings.map((m) => ({
        roomTypeId: new Types.ObjectId(m.roomTypeId),
        externalRoomCode: m.externalRoomCode,
      }));
    }
    const updated = (await ChannelConnectionModel.findByIdAndUpdate(
      c._id,
      { $set: set },
      { new: true },
    ).lean<ChannelConnectionRecord>())!;
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'channel.updated',
      entityType: 'ChannelConnection',
      entityId: id,
      metadata: {
        before: { status: c.status, mappings: c.mappings.length },
        after: { status: updated.status, mappings: updated.mappings.length },
      },
      context,
    });
    return this.dto(updated);
  }

  async events(
    auth: AuthContext,
    hotelId: string,
    id: string,
    page: number,
    limit: number,
    status?: string,
  ) {
    const { c } = await this.connection(auth, hotelId, id, 'inventory:view');
    const filter = { connectionId: c._id, ...(status ? { status } : {}) };
    const [rows, total] = await Promise.all([
      ChannelEventModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<ChannelEventRecord[]>(),
      ChannelEventModel.countDocuments(filter),
    ]);
    return paginated(
      rows.map((e) => ({
        id: e._id.toString(),
        externalEventId: e.externalEventId,
        type: e.event.type,
        externalRef: e.event.externalRef,
        roomCode: e.event.externalRoomCode,
        checkIn: e.event.checkIn,
        checkOut: e.event.checkOut,
        rooms: e.event.rooms,
        status: e.status,
        attempts: e.attempts,
        error: e.error,
        conflictDates: e.conflictDates,
        createdAt: e.createdAt.toISOString(),
        processedAt: e.processedAt?.toISOString() ?? null,
      })),
      page,
      limit,
      total,
    );
  }

  async retryEvent(auth: AuthContext, hotelId: string, connectionId: string, eventId: string) {
    const { c } = await this.connection(auth, hotelId, connectionId);
    const e = Types.ObjectId.isValid(eventId)
      ? await ChannelEventModel.findOne({
          _id: eventId,
          connectionId: c._id,
        }).lean<ChannelEventRecord>()
      : null;
    if (!e) throw Errors.notFound('Event');
    if (!['FAILED', 'CONFLICT'].includes(e.status))
      throw new AppError(409, 'INVALID_STATE', 'Only failed or conflicting events can be retried.');
    return this.process(e, c);
  }

  // ------------------------------------------------------------------ inbound
  async receiveWebhook(
    connectionId: string,
    raw: Buffer,
    headers: Record<string, string | undefined>,
  ) {
    const c = Types.ObjectId.isValid(connectionId)
      ? await ChannelConnectionModel.findById(connectionId).lean<ChannelConnectionRecord>()
      : null;
    // Unknown connection and bad signature look the same to the caller.
    if (!c) throw new AppError(401, 'AUTH_REQUIRED', 'Invalid signature.');
    const adapter = this.adapter(c.provider);
    if (!adapter.verifySignature(raw, headers, this.deps.encryptor.decrypt(c.secretEncrypted)))
      throw new AppError(401, 'AUTH_REQUIRED', 'Invalid signature.');
    let events: NormalizedChannelEvent[];
    try {
      events = adapter.parse(raw);
    } catch (error) {
      if (error instanceof ChannelPayloadError) throw Errors.badRequest(error.message);
      throw error;
    }
    let accepted = 0;
    let duplicates = 0;
    for (const event of events) {
      let row: ChannelEventRecord;
      try {
        row = (
          await ChannelEventModel.create({
            connectionId: c._id,
            hotelId: c.hotelId,
            externalEventId: event.externalEventId,
            event,
            status: 'FAILED',
            error: 'Pending',
            nextAttemptAt: new Date(),
          })
        ).toObject() as ChannelEventRecord;
      } catch (error) {
        if (isMongoDuplicateKey(error)) {
          duplicates += 1;
          continue;
        }
        throw error;
      }
      accepted += 1;
      // Paused connections still record events (no data loss) but apply them when resumed.
      if (c.status === 'ACTIVE') await this.process(row, c);
    }
    return { accepted, duplicates };
  }

  private async process(e: ChannelEventRecord, c: ChannelConnectionRecord) {
    try {
      await this.apply(e.event, c);
      await ChannelEventModel.updateOne(
        { _id: e._id },
        {
          $set: {
            status: 'PROCESSED',
            error: null,
            conflictDates: [],
            processedAt: new Date(),
            nextAttemptAt: null,
          },
          $inc: { attempts: 1 },
        },
      );
    } catch (error) {
      const pe =
        error instanceof ProcessingError
          ? error
          : new ProcessingError((error as Error).message.slice(0, 300), 'FAILED');
      const attempts = e.attempts + 1;
      await ChannelEventModel.updateOne(
        { _id: e._id },
        {
          $set: {
            status: pe.status,
            error: pe.message,
            conflictDates: pe.conflictDates,
            nextAttemptAt:
              pe.status === 'FAILED' && attempts < MAX_ATTEMPTS ? backoff(attempts) : null,
          },
          $inc: { attempts: 1 },
        },
      );
      if (pe.status === 'CONFLICT')
        this.deps.logger.warn(
          { connectionId: c._id.toString(), dates: pe.conflictDates },
          'Channel reservation conflicts with Stayscape inventory',
        );
    }
    return (await ChannelEventModel.findById(e._id).lean<ChannelEventRecord>())!.status;
  }

  private async apply(ev: NormalizedChannelEvent, c: ChannelConnectionRecord) {
    const mapping = c.mappings.find((m) => m.externalRoomCode === ev.externalRoomCode);
    if (!mapping)
      throw new ProcessingError(
        `Room code ${ev.externalRoomCode} is not mapped to a room category`,
        'FAILED',
      );
    const roomType = await RoomTypeModel.findById(mapping.roomTypeId).lean<RoomTypeRecord>();
    if (!roomType) throw new ProcessingError('Mapped room category no longer exists', 'FAILED');
    const nights = dateRange(ev.checkIn, addDays(ev.checkOut, -1));
    if (ev.type === 'RESERVATION_CREATED') {
      if (
        await ChannelReservationModel.exists({ connectionId: c._id, externalRef: ev.externalRef })
      )
        return; // same reservation, different event id
      await withTransaction(async (session) => {
        await this.deps.inventory.ensureRows(c.hotelId, roomType, nights, session);
        const short = await DailyInventoryModel.find(
          {
            roomTypeId: roomType._id,
            localDate: { $in: nights },
            $expr: { $lt: [AVAILABLE_EXPR, ev.rooms] },
          },
          { localDate: 1 },
          { session },
        ).lean<Array<{ localDate: string }>>();
        // Overbooking: the channel sold rooms Stayscape no longer has. Recorded for a person to resolve.
        if (short.length)
          throw new ProcessingError(
            `Not enough rooms on ${short.length} night(s) — possible overbooking`,
            'CONFLICT',
            short.map((s) => s.localDate).sort(),
          );
        const res = await DailyInventoryModel.updateMany(
          {
            roomTypeId: roomType._id,
            localDate: { $in: nights },
            $expr: { $gte: [AVAILABLE_EXPR, ev.rooms] },
          },
          { $inc: { blockedRooms: ev.rooms, maintenanceRooms: ev.rooms } },
          { session },
        );
        if (res.modifiedCount !== nights.length)
          throw new ProcessingError('Inventory changed while applying; will retry', 'FAILED');
        await ChannelReservationModel.create(
          [
            {
              connectionId: c._id,
              externalRef: ev.externalRef,
              roomTypeId: roomType._id,
              nights,
              rooms: ev.rooms,
            },
          ],
          { session },
        );
      });
      return;
    }
    const r = await ChannelReservationModel.findOne({
      connectionId: c._id,
      externalRef: ev.externalRef,
    }).lean<ChannelReservationAttrs & { _id: Types.ObjectId }>();
    if (!r) throw new ProcessingError(`Unknown reservation ${ev.externalRef}`, 'FAILED');
    if (r.status === 'CANCELLED') return;
    await withTransaction(async (session) => {
      const claimed = await ChannelReservationModel.updateOne(
        { _id: r._id, status: 'ACTIVE' },
        { $set: { status: 'CANCELLED' } },
        { session },
      );
      if (claimed.modifiedCount !== 1) return;
      const res = await DailyInventoryModel.updateMany(
        {
          roomTypeId: r.roomTypeId,
          localDate: { $in: r.nights },
          maintenanceRooms: { $gte: r.rooms },
        },
        { $inc: { blockedRooms: -r.rooms, maintenanceRooms: -r.rooms } },
        { session },
      );
      if (res.modifiedCount !== r.nights.length)
        throw new ProcessingError('Channel inventory is inconsistent', 'FAILED');
    });
  }

  // ------------------------------------------------------------------ outbound + retries (scheduled)
  async syncNow(auth: AuthContext, hotelId: string, id: string) {
    const { c } = await this.connection(auth, hotelId, id);
    await this.sync(c);
    return this.dto(
      (await ChannelConnectionModel.findById(c._id).lean<ChannelConnectionRecord>())!,
    );
  }

  private async sync(c: ChannelConnectionRecord) {
    const adapter = this.adapter(c.provider);
    const roomTypes = await RoomTypeModel.find({
      _id: { $in: c.mappings.map((m) => m.roomTypeId) },
    }).lean<RoomTypeRecord[]>();
    const tz = 'Asia/Kolkata';
    const dates = dateRange(todayInTimeZone(tz), addDays(todayInTimeZone(tz), SYNC_DAYS - 1));
    const availability = await this.deps.inventory.availabilityFor(roomTypes, dates);
    const days = c.mappings.flatMap((m) => {
      const map = availability.get(m.roomTypeId.toString());
      return map
        ? dates.map((d) => ({
            externalRoomCode: m.externalRoomCode,
            date: d,
            available: Math.max(0, map.get(d)?.available ?? 0),
            stopSell: (map.get(d)?.available ?? 0) <= 0,
          }))
        : [];
    });
    try {
      await adapter.pushAvailability(
        c._id.toString(),
        this.deps.encryptor.decrypt(c.secretEncrypted),
        days,
      );
      await ChannelConnectionModel.updateOne(
        { _id: c._id },
        {
          $set: {
            syncStatus: 'OK',
            lastSyncAt: new Date(),
            lastError: null,
            consecutiveFailures: 0,
            nextSyncAt: new Date(Date.now() + 15 * 60_000),
          },
        },
      );
    } catch (error) {
      const msg = error instanceof ChannelDeliveryError ? error.message : 'Delivery failed';
      await ChannelConnectionModel.updateOne(
        { _id: c._id },
        {
          $set: {
            syncStatus: 'ERROR',
            lastError: msg,
            nextSyncAt: backoff(c.consecutiveFailures + 1),
          },
          $inc: { consecutiveFailures: 1 },
        },
      );
    }
  }

  async runScheduled(now = new Date()) {
    let retried = 0;
    const due = await ChannelEventModel.find({
      status: 'FAILED',
      attempts: { $lt: MAX_ATTEMPTS },
      nextAttemptAt: { $lte: now },
    })
      .limit(200)
      .lean<ChannelEventRecord[]>();
    for (const e of due) {
      const c = await ChannelConnectionModel.findById(
        e.connectionId,
      ).lean<ChannelConnectionRecord>();
      if (c?.status === 'ACTIVE') {
        await this.process(e, c);
        retried += 1;
      }
    }
    const connections = await ChannelConnectionModel.find({
      status: 'ACTIVE',
      'mappings.0': { $exists: true },
      $or: [{ nextSyncAt: null }, { nextSyncAt: { $lte: now } }],
    })
      .limit(100)
      .lean<ChannelConnectionRecord[]>();
    for (const c of connections) await this.sync(c);
    return { retried, synced: connections.length };
  }
}
