import { Types } from 'mongoose';
import { dateRange, todayInTimeZone } from '@stayscape/shared';
import { withTransaction } from '@/lib/transaction';
import { AppError, Errors } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import type { AuditService } from '@/modules/audit/audit.service';
import type { PartnerAccessService } from '@/modules/partners/partner-access.service';
import { RoomTypeModel, type RoomTypeRecord } from '@/modules/rooms/room.models';
import type { AuthContext } from '@/types/express';
import type { INVENTORY_BLOCK_REASONS } from './inventory.models';
import {
  AVAILABLE_EXPR,
  DailyInventoryModel,
  InventoryBlockModel,
  type InventoryBlockRecord,
} from './inventory.models';
import { InventoryConflictError, type InventoryService } from './inventory.service';

const toDto = (b: InventoryBlockRecord) => ({
  id: b._id.toString(),
  roomTypeId: b.roomTypeId.toString(),
  from: b.from,
  to: b.to,
  rooms: b.rooms,
  reason: b.reason,
  note: b.note,
  status: b.status,
  releasedFrom: b.releasedFrom,
  createdAt: b.createdAt.toISOString(),
  releasedAt: b.releasedAt?.toISOString() ?? null,
});

/** Maintenance / renovation / owner-use blocks (inventory:manage), applied all-nights-or-none. */
export class InventoryBlocksService {
  constructor(
    private readonly deps: {
      access: PartnerAccessService;
      inventory: InventoryService;
      audit: AuditService;
    },
  ) {}

  private async roomType(hotelId: Types.ObjectId, id: string): Promise<RoomTypeRecord> {
    const rt = Types.ObjectId.isValid(id)
      ? await RoomTypeModel.findOne({ _id: id, hotelId }).lean<RoomTypeRecord>()
      : null;
    if (!rt || rt.status === 'ARCHIVED') throw Errors.notFound('Room category');
    return rt;
  }

  async list(auth: AuthContext, hotelId: string, status: 'ACTIVE' | 'RELEASED' = 'ACTIVE') {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'inventory:view');
    const rows = await InventoryBlockModel.find({ hotelId: hotel._id, status })
      .sort({ from: 1 })
      .limit(200)
      .lean<InventoryBlockRecord[]>();
    return rows.map(toDto);
  }

  async create(
    auth: AuthContext,
    hotelId: string,
    input: {
      roomTypeId: string;
      from: string;
      to: string;
      rooms: number;
      reason: (typeof INVENTORY_BLOCK_REASONS)[number];
      note: string;
    },
    context: RequestContext,
  ) {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'inventory:manage');
    const roomType = await this.roomType(hotel._id, input.roomTypeId);
    const today = todayInTimeZone(hotel.timeZone);
    if (input.from < today)
      throw Errors.validation({ fieldErrors: { from: ['Blocks must start today or later'] } });
    if (input.rooms > roomType.totalInventory)
      throw Errors.validation({
        fieldErrors: { rooms: [`This category has ${roomType.totalInventory} rooms`] },
      });
    const dates = dateRange(input.from, input.to);
    const block = await withTransaction(async (session) => {
      await this.deps.inventory.ensureRows(hotel._id, roomType, dates, session);
      const short = await DailyInventoryModel.find(
        {
          roomTypeId: roomType._id,
          localDate: { $in: dates },
          $expr: { $lt: [AVAILABLE_EXPR, input.rooms] },
        },
        { localDate: 1 },
        { session },
      ).lean<Array<{ localDate: string }>>();
      if (short.length)
        throw new InventoryConflictError(
          `Reservations or holds already use those rooms on ${short.length} date(s).`,
          short.map((d) => d.localDate).sort(),
        );
      // The conditional update still guards against a concurrent hold landing in between.
      const result = await DailyInventoryModel.updateMany(
        {
          roomTypeId: roomType._id,
          localDate: { $in: dates },
          $expr: { $gte: [AVAILABLE_EXPR, input.rooms] },
        },
        { $inc: { blockedRooms: input.rooms, maintenanceRooms: input.rooms } },
        { session },
      );
      if (result.modifiedCount !== dates.length)
        throw new InventoryConflictError('Inventory changed while saving. Please retry.', []);
      const [created] = await InventoryBlockModel.create(
        [{ ...input, hotelId: hotel._id, roomTypeId: roomType._id, createdBy: auth.userId }],
        { session },
      );
      return created!.toObject() as InventoryBlockRecord;
    });
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'inventory.block_created',
      entityType: 'InventoryBlock',
      entityId: block._id.toString(),
      metadata: { before: null, after: toDto(block) },
      context,
    });
    return toDto(block);
  }

  async release(auth: AuthContext, hotelId: string, blockId: string, context: RequestContext) {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'inventory:manage');
    if (!Types.ObjectId.isValid(blockId)) throw Errors.notFound('Block');
    const today = todayInTimeZone(hotel.timeZone);
    const released = await withTransaction(async (session) => {
      // Claim the block first so concurrent releases cannot both return the rooms.
      const block = await InventoryBlockModel.findOneAndUpdate(
        { _id: blockId, hotelId: hotel._id, status: 'ACTIVE' },
        {
          $set: {
            status: 'RELEASED',
            releasedBy: auth.userId,
            releasedAt: new Date(),
            releasedFrom: today,
          },
        },
        { new: true, session },
      ).lean<InventoryBlockRecord>();
      if (!block) {
        if (await InventoryBlockModel.exists({ _id: blockId, hotelId: hotel._id }))
          throw new AppError(409, 'INVALID_STATE', 'This block was already released.');
        throw Errors.notFound('Block');
      }
      const start = block.from > today ? block.from : today;
      if (start <= block.to) {
        const dates = dateRange(start, block.to);
        const result = await DailyInventoryModel.updateMany(
          {
            roomTypeId: block.roomTypeId,
            localDate: { $in: dates },
            maintenanceRooms: { $gte: block.rooms },
          },
          { $inc: { blockedRooms: -block.rooms, maintenanceRooms: -block.rooms } },
          { session },
        );
        if (result.modifiedCount !== dates.length)
          throw new InventoryConflictError('Blocked inventory is inconsistent.', dates);
      }
      return block;
    });
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'inventory.block_released',
      entityType: 'InventoryBlock',
      entityId: blockId,
      metadata: {
        before: { status: 'ACTIVE' },
        after: { status: 'RELEASED', releasedFrom: today },
      },
      context,
    });
    return toDto(released);
  }
}
