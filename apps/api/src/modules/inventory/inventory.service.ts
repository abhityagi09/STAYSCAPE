import type { Types } from 'mongoose';
import { type ClientSession } from 'mongoose';
import {
  addDays,
  dateRange,
  dayOfWeek,
  todayInTimeZone,
  type InventoryDayDto,
  type InventoryUpdateInput,
} from '@stayscape/shared';
import { AppError, Errors } from '@/lib/errors';
import { withTransaction } from '@/lib/transaction';
import type { HotelRecord } from '@/modules/hotels/hotel.model';
import type { RoomTypeRecord } from '@/modules/rooms/room.models';
import { AVAILABLE_EXPR, DailyInventoryModel, type DailyInventoryRecord } from './inventory.models';

export interface DayAvailability {
  available: number;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  minimumStay: number | null;
  maximumStay: number | null;
  /** (held + booked) / (total - blocked) in basis points; 0 when nothing is sellable or no row exists. */
  occupancyBp: number;
}

/** Thrown when a requested change or reservation would break the availability invariant. */
export class InventoryConflictError extends AppError {
  constructor(
    message: string,
    public readonly dates: string[],
    code: 'CONFLICT' | 'INVENTORY_UNAVAILABLE' = 'CONFLICT',
  ) {
    super(409, code, message, { dates });
  }
}

const sessionOpt = (session?: ClientSession) => (session ? { session } : {});

export class InventoryService {
  /** Materialise rows (idempotently) so conditional updates have a document to act on. */
  async ensureRows(
    hotelId: Types.ObjectId,
    roomType: Pick<RoomTypeRecord, '_id' | 'totalInventory'>,
    dates: string[],
    session?: ClientSession,
  ): Promise<void> {
    if (dates.length === 0) return;
    await DailyInventoryModel.bulkWrite(
      dates.map((localDate) => ({
        updateOne: {
          filter: { roomTypeId: roomType._id, localDate },
          update: {
            $setOnInsert: {
              hotelId,
              roomTypeId: roomType._id,
              localDate,
              totalRooms: roomType.totalInventory,
              blockedRooms: 0,
              heldRooms: 0,
              bookedRooms: 0,
              closedToArrival: false,
              closedToDeparture: false,
              minimumStay: null,
              maximumStay: null,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false, ...sessionOpt(session) },
    );
  }

  async getCalendar(
    roomType: RoomTypeRecord,
    from: string,
    to: string,
  ): Promise<InventoryDayDto[]> {
    const rows = await DailyInventoryModel.find({
      roomTypeId: roomType._id,
      localDate: { $gte: from, $lte: to },
    }).lean<DailyInventoryRecord[]>();
    const byDate = new Map(rows.map((r) => [r.localDate, r]));
    return dateRange(from, to).map((date) => {
      const row = byDate.get(date);
      const total = row?.totalRooms ?? roomType.totalInventory;
      const blocked = row?.blockedRooms ?? 0;
      const maintenance = row?.maintenanceRooms ?? 0;
      const held = row?.heldRooms ?? 0;
      const booked = row?.bookedRooms ?? 0;
      const stopSell = row?.stopSell ?? false;
      return {
        date,
        totalRooms: total,
        blockedRooms: blocked - maintenance,
        maintenanceRooms: maintenance,
        stopSell,
        heldRooms: held,
        bookedRooms: booked,
        available: stopSell ? 0 : total - blocked - held - booked,
        closedToArrival: row?.closedToArrival ?? false,
        closedToDeparture: row?.closedToDeparture ?? false,
        minimumStay: row?.minimumStay ?? null,
        maximumStay: row?.maximumStay ?? null,
      };
    });
  }

  /**
   * Bulk update a date range atomically (all dates or none). Blocking is rejected for any date
   * where blocked + held + booked would exceed total rooms — partners can never take away rooms
   * already committed to reservations or active holds.
   */
  async bulkUpdate(
    hotel: HotelRecord,
    roomType: RoomTypeRecord,
    input: InventoryUpdateInput,
  ): Promise<InventoryDayDto[]> {
    const today = todayInTimeZone(hotel.timeZone);
    if (input.to < today) throw Errors.badRequest('Past dates cannot be changed.');
    const from = input.from < today ? today : input.from;
    const days = input.daysOfWeek ?? [];
    const dates = dateRange(from, input.to).filter(
      (d) => days.length === 0 || days.includes(dayOfWeek(d)),
    );
    if (dates.length === 0) throw Errors.badRequest('No dates match the selected days.');
    const { set } = input;

    await withTransaction(async (session) => {
      await this.ensureRows(hotel._id, roomType, dates, session);
      const update: Record<string, unknown> = {};
      for (const key of [
        'stopSell',
        'closedToArrival',
        'closedToDeparture',
        'minimumStay',
        'maximumStay',
      ] as const) {
        if (set[key] !== undefined) update[key] = set[key];
      }
      const filter: Record<string, unknown> = {
        roomTypeId: roomType._id,
        localDate: { $in: dates },
      };
      if (set.blockedRooms !== undefined) {
        const violating = await DailyInventoryModel.find(
          {
            ...filter,
            $expr: {
              $lt: [
                {
                  $subtract: [
                    '$totalRooms',
                    { $add: ['$heldRooms', '$bookedRooms', { $ifNull: ['$maintenanceRooms', 0] }] },
                  ],
                },
                set.blockedRooms,
              ],
            },
          },
          { localDate: 1 },
          { session },
        ).lean<Array<{ localDate: string }>>();
        if (violating.length) {
          throw new InventoryConflictError(
            `Cannot block ${set.blockedRooms} rooms: reservations or active holds already use those rooms on ${violating.length} date(s).`,
            violating.map((v) => v.localDate).sort(),
          );
        }
        filter.$expr = {
          $gte: [
            {
              $subtract: [
                '$totalRooms',
                { $add: ['$heldRooms', '$bookedRooms', { $ifNull: ['$maintenanceRooms', 0] }] },
              ],
            },
            set.blockedRooms,
          ],
        };
      }
      // Manual blocks are set on top of maintenance blocks, never replacing them (pipeline update).
      if (set.blockedRooms !== undefined)
        update.blockedRooms = { $add: [set.blockedRooms, { $ifNull: ['$maintenanceRooms', 0] }] };
      const result = await DailyInventoryModel.updateMany(filter, [{ $set: update }], { session });
      if (result.matchedCount !== dates.length)
        throw new InventoryConflictError('Inventory changed while saving. Please retry.', []);
    });
    return this.getCalendar(roomType, input.from, input.to);
  }

  /** Apply a new room count to future dates; refuses if any date would fall below commitments. */
  async syncTotalInventory(
    hotel: HotelRecord,
    roomType: RoomTypeRecord,
    newTotal: number,
    session?: ClientSession,
  ): Promise<void> {
    const today = todayInTimeZone(hotel.timeZone);
    const filter = { roomTypeId: roomType._id, localDate: { $gte: today } };
    const violating = await DailyInventoryModel.find(
      {
        ...filter,
        $expr: { $lt: [newTotal, { $add: ['$blockedRooms', '$heldRooms', '$bookedRooms'] }] },
      },
      { localDate: 1 },
      sessionOpt(session),
    ).lean<Array<{ localDate: string }>>();
    if (violating.length) {
      throw new InventoryConflictError(
        `Cannot reduce to ${newTotal} rooms: blocked rooms, reservations or holds exceed that on ${violating.length} date(s). Unblock or wait for those dates first.`,
        violating
          .map((v) => v.localDate)
          .sort()
          .slice(0, 50),
      );
    }
    await DailyInventoryModel.updateMany(
      {
        ...filter,
        $expr: { $gte: [newTotal, { $add: ['$blockedRooms', '$heldRooms', '$bookedRooms'] }] },
      },
      { $set: { totalRooms: newTotal } },
      sessionOpt(session),
    );
  }

  /** Whether a room type has ever had committed stock (then it must be archived, not deleted). */
  async hasCommitments(roomTypeId: Types.ObjectId): Promise<boolean> {
    return Boolean(
      await DailyInventoryModel.exists({
        roomTypeId,
        $or: [{ bookedRooms: { $gt: 0 } }, { heldRooms: { $gt: 0 } }],
      }),
    );
  }

  async hasFutureCommitments(hotel: HotelRecord): Promise<boolean> {
    const today = todayInTimeZone(hotel.timeZone);
    return Boolean(
      await DailyInventoryModel.exists({
        hotelId: hotel._id,
        localDate: { $gte: today },
        $or: [{ bookedRooms: { $gt: 0 } }, { heldRooms: { $gt: 0 } }],
      }),
    );
  }

  /** Per-date availability for many room types at once (defaults for dates with no row). */
  async availabilityFor(
    roomTypes: Array<Pick<RoomTypeRecord, '_id' | 'totalInventory'>>,
    dates: string[],
  ): Promise<Map<string, Map<string, DayAvailability>>> {
    const result = new Map<string, Map<string, DayAvailability>>();
    if (roomTypes.length === 0 || dates.length === 0) return result;
    const rows = await DailyInventoryModel.find(
      { roomTypeId: { $in: roomTypes.map((r) => r._id) }, localDate: { $in: dates } },
      {
        roomTypeId: 1,
        localDate: 1,
        totalRooms: 1,
        blockedRooms: 1,
        stopSell: 1,
        heldRooms: 1,
        bookedRooms: 1,
        closedToArrival: 1,
        closedToDeparture: 1,
        minimumStay: 1,
        maximumStay: 1,
      },
    ).lean<DailyInventoryRecord[]>();
    for (const roomType of roomTypes) {
      const map = new Map<string, DayAvailability>();
      for (const date of dates)
        map.set(date, {
          available: roomType.totalInventory,
          closedToArrival: false,
          closedToDeparture: false,
          minimumStay: null,
          maximumStay: null,
          occupancyBp: 0,
        });
      result.set(roomType._id.toString(), map);
    }
    for (const row of rows) {
      result.get(row.roomTypeId.toString())?.set(row.localDate, {
        available: row.stopSell
          ? 0
          : row.totalRooms - row.blockedRooms - row.heldRooms - row.bookedRooms,
        closedToArrival: row.closedToArrival,
        closedToDeparture: row.closedToDeparture,
        minimumStay: row.minimumStay,
        maximumStay: row.maximumStay,
        occupancyBp:
          row.totalRooms - row.blockedRooms > 0
            ? Math.round(
                ((row.heldRooms + row.bookedRooms) * 10_000) / (row.totalRooms - row.blockedRooms),
              )
            : 0,
      });
    }
    return result;
  }

  // ------------------------------------------------------------------ reservation primitives
  //
  // Used by the booking services inside THEIR transaction (pass the session). Each primitive is a
  // single conditional updateMany over every night of the stay: if any night fails its condition
  // the count differs and the primitive throws, aborting the caller's whole transaction — all
  // nights or none. Counters are additionally protected by the collection validator.

  private async applyToNights(
    roomTypeId: Types.ObjectId,
    nights: string[],
    condition: Record<string, unknown>,
    update: Record<string, unknown>,
    session: ClientSession,
    onShortfall: () => Error,
  ): Promise<void> {
    if (nights.length === 0) throw Errors.badRequest('A stay needs at least one night.');
    const result = await DailyInventoryModel.updateMany(
      { roomTypeId, localDate: { $in: nights }, ...condition },
      update,
      { session },
    );
    if (result.modifiedCount !== nights.length) throw onShortfall();
  }

  /** Hold `quantity` rooms on every night (available ≥ quantity required on each). */
  async reserveHeld(
    roomType: Pick<RoomTypeRecord, '_id' | 'hotelId' | 'totalInventory'>,
    nights: string[],
    quantity: number,
    session: ClientSession,
  ): Promise<void> {
    await this.ensureRows(roomType.hotelId, roomType, nights, session);
    await this.applyToNights(
      roomType._id,
      nights,
      { stopSell: { $ne: true }, $expr: { $gte: [AVAILABLE_EXPR, quantity] } },
      { $inc: { heldRooms: quantity } },
      session,
      () =>
        new InventoryConflictError(
          'Not enough rooms are available for every night of this stay.',
          [],
          'INVENTORY_UNAVAILABLE',
        ),
    );
  }

  /** Return held rooms to availability (hold released or expired). */
  async releaseHeld(
    roomTypeId: Types.ObjectId,
    nights: string[],
    quantity: number,
    session: ClientSession,
  ): Promise<void> {
    await this.applyToNights(
      roomTypeId,
      nights,
      { heldRooms: { $gte: quantity } },
      { $inc: { heldRooms: -quantity } },
      session,
      () => new InventoryConflictError('Inventory hold is inconsistent.', nights),
    );
  }

  /** Convert held rooms into booked rooms (payment confirmed). */
  async commitHeld(
    roomTypeId: Types.ObjectId,
    nights: string[],
    quantity: number,
    session: ClientSession,
  ): Promise<void> {
    await this.applyToNights(
      roomTypeId,
      nights,
      { heldRooms: { $gte: quantity } },
      { $inc: { heldRooms: -quantity, bookedRooms: quantity } },
      session,
      () => new InventoryConflictError('Inventory hold is inconsistent.', nights),
    );
  }

  /**
   * Book directly without a hold — only used to re-allocate a booking whose hold expired while a
   * verified payment was in flight. Same availability condition as a new hold.
   */
  async bookDirect(
    roomType: Pick<RoomTypeRecord, '_id' | 'hotelId' | 'totalInventory'>,
    nights: string[],
    quantity: number,
    session: ClientSession,
  ): Promise<void> {
    await this.ensureRows(roomType.hotelId, roomType, nights, session);
    await this.applyToNights(
      roomType._id,
      nights,
      { stopSell: { $ne: true }, $expr: { $gte: [AVAILABLE_EXPR, quantity] } },
      { $inc: { bookedRooms: quantity } },
      session,
      () =>
        new InventoryConflictError(
          'The rooms are no longer available for every night.',
          [],
          'INVENTORY_UNAVAILABLE',
        ),
    );
  }

  /** Release booked rooms (cancellation / no-show). */
  async releaseBooked(
    roomTypeId: Types.ObjectId,
    nights: string[],
    quantity: number,
    session: ClientSession,
  ): Promise<void> {
    await this.applyToNights(
      roomTypeId,
      nights,
      { bookedRooms: { $gte: quantity } },
      { $inc: { bookedRooms: -quantity } },
      session,
      () => new InventoryConflictError('Booked inventory is inconsistent.', nights),
    );
  }

  async purgeRoomType(roomTypeId: Types.ObjectId, session?: ClientSession) {
    await DailyInventoryModel.deleteMany({ roomTypeId }, sessionOpt(session));
  }

  static nextDays(start: string, count: number) {
    return Array.from({ length: count }, (_, i) => addDays(start, i));
  }
}
