import { Types } from 'mongoose';
import {
  roomTypeSchema,
  type PartnerRoomTypeDto,
  type PricingRuleDto,
  type PricingRuleInput,
  type RatePlanDto,
  type RatePlanInput,
  type RoomTypeInput,
} from '@stayscape/shared';
import { AppError, Errors } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import type { CacheService } from '@/modules/catalog/cache.service';
import { imageMap, resolveImages } from '@/modules/hotels/hotel.mapper';
import type { HotelRecord } from '@/modules/hotels/hotel.model';
import type { InventoryService } from '@/modules/inventory/inventory.service';
import type { MediaService } from '@/modules/media/media.service';
import type { PartnerAccessService } from '@/modules/partners/partner-access.service';
import type { AuthContext } from '@/types/express';
import {
  PricingRuleModel,
  RatePlanModel,
  RoomTypeModel,
  type PricingRuleRecord,
  type RatePlanRecord,
  type RoomTypeRecord,
} from './room.models';

export function toRatePlanDto(r: RatePlanRecord): RatePlanDto {
  return {
    id: r._id.toString(),
    hotelId: r.hotelId.toString(),
    roomTypeId: r.roomTypeId.toString(),
    name: r.name,
    mealPlan: r.mealPlan,
    cancellationPolicy: {
      type: r.cancellationPolicy.type,
      freeCancellationHours: r.cancellationPolicy.freeCancellationHours,
      refundBasisPointsAfterDeadline: r.cancellationPolicy.refundBasisPointsAfterDeadline,
      ...(r.cancellationPolicy.description
        ? { description: r.cancellationPolicy.description }
        : {}),
    },
    currency: r.currency,
    basePriceMinor: r.basePriceMinor,
    includedAdults: r.includedAdults,
    includedChildren: r.includedChildren,
    additionalAdultPriceMinor: r.additionalAdultPriceMinor,
    additionalChildPriceMinor: r.additionalChildPriceMinor,
    extraBedPriceMinor: r.extraBedPriceMinor,
    mealSupplementPerGuestMinor: r.mealSupplementPerGuestMinor,
    minimumStay: r.minimumStay,
    maximumStay: r.maximumStay,
    active: r.active,
  };
}

export function toPricingRuleDto(r: PricingRuleRecord): PricingRuleDto {
  return {
    id: r._id.toString(),
    hotelId: r.hotelId.toString(),
    name: r.name,
    roomTypeId: r.roomTypeId?.toString() ?? null,
    ratePlanId: r.ratePlanId?.toString() ?? null,
    ruleType: r.ruleType,
    startDate: r.startDate,
    endDate: r.endDate,
    daysOfWeek: r.daysOfWeek,
    adjustmentType: r.adjustmentType,
    adjustmentValue: r.adjustmentValue,
    priority: r.priority,
    stackingPolicy: r.stackingPolicy,
    conditions: { ...r.conditions },
    active: r.active,
  };
}

interface Deps {
  access: PartnerAccessService;
  inventory: InventoryService;
  media: MediaService;
  audit: AuditService;
  cache: CacheService;
}

export class RoomsService {
  constructor(private readonly deps: Deps) {}

  private async roomTypeOf(hotel: HotelRecord, roomTypeId: string): Promise<RoomTypeRecord> {
    if (!Types.ObjectId.isValid(roomTypeId)) throw Errors.notFound('Room category');
    const roomType = await RoomTypeModel.findOne({
      _id: roomTypeId,
      hotelId: hotel._id,
    }).lean<RoomTypeRecord>();
    if (!roomType) throw Errors.notFound('Room category');
    return roomType;
  }

  private async toRoomDtos(roomTypes: RoomTypeRecord[]): Promise<PartnerRoomTypeDto[]> {
    const assets = imageMap(
      await this.deps.media.findImages(roomTypes.flatMap((r) => r.images.map((i) => i.mediaId))),
    );
    return roomTypes.map((r) => ({
      id: r._id.toString(),
      hotelId: r.hotelId.toString(),
      name: r.name,
      description: r.description,
      images: resolveImages(r.images, assets),
      imageRefs: r.images.map((i) => ({ mediaId: i.mediaId.toString(), alt: i.alt ?? '' })),
      roomSize: r.roomSize,
      roomSizeUnit: r.roomSizeUnit,
      bedConfiguration: r.bedConfiguration,
      maximumAdults: r.maximumAdults,
      maximumChildren: r.maximumChildren,
      maximumOccupancy: r.maximumOccupancy,
      amenities: r.amenities,
      totalInventory: r.totalInventory,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  private async validateImages(
    hotel: HotelRecord,
    partnerId: string,
    images: Array<{ mediaId: string }>,
  ) {
    const ids = images.map((i) => i.mediaId);
    await this.deps.media.assertOwnedImages(partnerId, hotel._id.toString(), ids);
    return ids;
  }

  // ------------------------------------------------------------------ room types
  async listRoomTypes(
    auth: AuthContext,
    hotelId: string,
    includeArchived = false,
  ): Promise<PartnerRoomTypeDto[]> {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'rooms:manage');
    const filter: Record<string, unknown> = { hotelId: hotel._id };
    if (!includeArchived) filter.status = { $ne: 'ARCHIVED' };
    return this.toRoomDtos(
      await RoomTypeModel.find(filter).sort({ createdAt: 1 }).lean<RoomTypeRecord[]>(),
    );
  }

  async getRoomType(
    auth: AuthContext,
    hotelId: string,
    roomTypeId: string,
  ): Promise<PartnerRoomTypeDto> {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'rooms:manage');
    return (await this.toRoomDtos([await this.roomTypeOf(hotel, roomTypeId)]))[0]!;
  }

  async createRoomType(
    auth: AuthContext,
    hotelId: string,
    input: RoomTypeInput,
    context: RequestContext,
  ): Promise<PartnerRoomTypeDto> {
    const { hotel, partner } = await this.deps.access.resolveHotel(auth, hotelId, 'rooms:manage');
    if (hotel.publicationStatus === 'ARCHIVED')
      throw new AppError(409, 'CONFLICT', 'Archived listings cannot be changed.');
    const parsed = roomTypeSchema.parse(input);
    const ids = await this.validateImages(hotel, partner._id.toString(), parsed.images);
    const doc = await RoomTypeModel.create({
      ...parsed,
      hotelId: hotel._id,
      images: parsed.images.map((i) => ({ mediaId: new Types.ObjectId(i.mediaId), alt: i.alt })),
    });
    await this.deps.media.markAttached(ids);
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'room_type.created',
      entityType: 'RoomType',
      entityId: doc._id.toString(),
      context,
    });
    return (await this.toRoomDtos([doc.toObject() as RoomTypeRecord]))[0]!;
  }

  /**
   * Update a room category. Reducing `totalInventory` is applied to every future date in the
   * same transaction and refused if any date's blocked/held/booked rooms exceed the new count.
   */
  async updateRoomType(
    auth: AuthContext,
    hotelId: string,
    roomTypeId: string,
    input: RoomTypeInput,
    context: RequestContext,
  ): Promise<PartnerRoomTypeDto> {
    const { hotel, partner } = await this.deps.access.resolveHotel(auth, hotelId, 'rooms:manage');
    const current = await this.roomTypeOf(hotel, roomTypeId);
    if (current.status === 'ARCHIVED')
      throw new AppError(409, 'CONFLICT', 'Archived room categories cannot be edited.');
    const parsed = roomTypeSchema.parse(input);
    const ids = await this.validateImages(hotel, partner._id.toString(), parsed.images);
    const updated = await withTransaction(async (session) => {
      if (parsed.totalInventory !== current.totalInventory)
        await this.deps.inventory.syncTotalInventory(
          hotel,
          current,
          parsed.totalInventory,
          session,
        );
      return RoomTypeModel.findOneAndUpdate(
        { _id: current._id, hotelId: hotel._id },
        {
          $set: {
            ...parsed,
            images: parsed.images.map((i) => ({
              mediaId: new Types.ObjectId(i.mediaId),
              alt: i.alt,
            })),
          },
        },
        { new: true, runValidators: true, session },
      ).lean<RoomTypeRecord>();
    });
    if (!updated) throw Errors.notFound('Room category');
    await this.deps.media.markAttached(ids);
    await this.deps.cache.invalidatePublic();
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'room_type.updated',
      entityType: 'RoomType',
      entityId: roomTypeId,
      metadata: { totalInventory: { from: current.totalInventory, to: parsed.totalInventory } },
      context,
    });
    return (await this.toRoomDtos([updated]))[0]!;
  }

  /** Categories that have ever had reservations or holds are archived; others are removed. */
  async deleteRoomType(
    auth: AuthContext,
    hotelId: string,
    roomTypeId: string,
    context: RequestContext,
  ): Promise<{ archived: boolean }> {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'rooms:manage');
    const roomType = await this.roomTypeOf(hotel, roomTypeId);
    const archived = await this.deps.inventory.hasCommitments(roomType._id);
    if (archived) {
      await RoomTypeModel.updateOne({ _id: roomType._id }, { $set: { status: 'ARCHIVED' } });
      await RatePlanModel.updateMany({ roomTypeId: roomType._id }, { $set: { active: false } });
    } else {
      await withTransaction(async (session) => {
        await RoomTypeModel.deleteOne({ _id: roomType._id }, { session });
        await RatePlanModel.deleteMany({ roomTypeId: roomType._id }, { session });
        await PricingRuleModel.deleteMany({ roomTypeId: roomType._id }, { session });
        await this.deps.inventory.purgeRoomType(roomType._id, session);
      });
    }
    await this.deps.cache.invalidatePublic();
    await this.deps.audit.record({
      actorId: auth.userId,
      action: archived ? 'room_type.archived' : 'room_type.deleted',
      entityType: 'RoomType',
      entityId: roomTypeId,
      context,
    });
    return { archived };
  }

  // ------------------------------------------------------------------ rate plans
  async listRatePlans(auth: AuthContext, hotelId: string): Promise<RatePlanDto[]> {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'pricing:manage');
    return (
      await RatePlanModel.find({ hotelId: hotel._id })
        .sort({ createdAt: 1 })
        .lean<RatePlanRecord[]>()
    ).map(toRatePlanDto);
  }

  async saveRatePlan(
    auth: AuthContext,
    hotelId: string,
    ratePlanId: string | null,
    input: RatePlanInput & { roomTypeId: string },
    context: RequestContext,
  ): Promise<RatePlanDto> {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'pricing:manage');
    const roomType = await this.roomTypeOf(hotel, input.roomTypeId);
    if (roomType.status === 'ARCHIVED')
      throw new AppError(409, 'CONFLICT', 'Archived room categories cannot have rate plans.');
    if (input.currency && input.currency !== hotel.currency)
      throw Errors.validation({
        fieldErrors: { currency: [`Rates must use the property currency (${hotel.currency})`] },
      });
    const data = {
      ...input,
      currency: hotel.currency,
      roomTypeId: roomType._id,
      hotelId: hotel._id,
    };
    let record: RatePlanRecord | null;
    if (ratePlanId) {
      if (!Types.ObjectId.isValid(ratePlanId)) throw Errors.notFound('Rate plan');
      record = await RatePlanModel.findOneAndUpdate(
        { _id: ratePlanId, hotelId: hotel._id },
        { $set: data },
        { new: true, runValidators: true },
      ).lean<RatePlanRecord>();
      if (!record) throw Errors.notFound('Rate plan');
    } else {
      record = (await RatePlanModel.create(data)).toObject() as RatePlanRecord;
    }
    await this.deps.cache.invalidatePublic();
    await this.deps.audit.record({
      actorId: auth.userId,
      action: ratePlanId ? 'rate_plan.updated' : 'rate_plan.created',
      entityType: 'RatePlan',
      entityId: record._id.toString(),
      context,
    });
    return toRatePlanDto(record);
  }

  async deleteRatePlan(
    auth: AuthContext,
    hotelId: string,
    ratePlanId: string,
    context: RequestContext,
  ): Promise<void> {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'pricing:manage');
    if (!Types.ObjectId.isValid(ratePlanId)) throw Errors.notFound('Rate plan');
    const result = await RatePlanModel.deleteOne({ _id: ratePlanId, hotelId: hotel._id });
    if (result.deletedCount === 0) throw Errors.notFound('Rate plan');
    await PricingRuleModel.deleteMany({ ratePlanId: new Types.ObjectId(ratePlanId) });
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'rate_plan.deleted',
      entityType: 'RatePlan',
      entityId: ratePlanId,
      context,
    });
  }

  // ------------------------------------------------------------------ pricing rules
  async listRules(auth: AuthContext, hotelId: string): Promise<PricingRuleDto[]> {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'pricing:manage');
    return (
      await PricingRuleModel.find({ hotelId: hotel._id })
        .sort({ priority: -1, createdAt: 1 })
        .lean<PricingRuleRecord[]>()
    ).map(toPricingRuleDto);
  }

  async saveRule(
    auth: AuthContext,
    hotelId: string,
    ruleId: string | null,
    input: PricingRuleInput,
    context: RequestContext,
  ): Promise<PricingRuleDto> {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'pricing:manage');
    if (input.roomTypeId) await this.roomTypeOf(hotel, input.roomTypeId);
    if (
      input.ratePlanId &&
      !(await RatePlanModel.exists({ _id: input.ratePlanId, hotelId: hotel._id }))
    )
      throw Errors.notFound('Rate plan');
    const data = {
      ...input,
      hotelId: hotel._id,
      roomTypeId: input.roomTypeId ? new Types.ObjectId(input.roomTypeId) : null,
      ratePlanId: input.ratePlanId ? new Types.ObjectId(input.ratePlanId) : null,
    };
    let record: PricingRuleRecord | null;
    if (ruleId) {
      if (!Types.ObjectId.isValid(ruleId)) throw Errors.notFound('Pricing rule');
      record = await PricingRuleModel.findOneAndUpdate(
        { _id: ruleId, hotelId: hotel._id },
        { $set: data },
        { new: true, runValidators: true },
      ).lean<PricingRuleRecord>();
      if (!record) throw Errors.notFound('Pricing rule');
    } else {
      record = (await PricingRuleModel.create(data)).toObject() as PricingRuleRecord;
    }
    await this.deps.audit.record({
      actorId: auth.userId,
      action: ruleId ? 'pricing_rule.updated' : 'pricing_rule.created',
      entityType: 'PricingRule',
      entityId: record._id.toString(),
      context,
    });
    return toPricingRuleDto(record);
  }

  async deleteRule(
    auth: AuthContext,
    hotelId: string,
    ruleId: string,
    context: RequestContext,
  ): Promise<void> {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'pricing:manage');
    if (!Types.ObjectId.isValid(ruleId)) throw Errors.notFound('Pricing rule');
    const result = await PricingRuleModel.deleteOne({ _id: ruleId, hotelId: hotel._id });
    if (result.deletedCount === 0) throw Errors.notFound('Pricing rule');
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'pricing_rule.deleted',
      entityType: 'PricingRule',
      entityId: ruleId,
      context,
    });
  }

  // ------------------------------------------------------------------ inventory (partner)
  async calendar(
    auth: AuthContext,
    hotelId: string,
    query: { roomTypeId: string; from: string; to: string },
  ) {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'inventory:view');
    const roomType = await this.roomTypeOf(hotel, query.roomTypeId);
    return this.deps.inventory.getCalendar(roomType, query.from, query.to);
  }

  async updateInventory(
    auth: AuthContext,
    hotelId: string,
    input: Parameters<InventoryService['bulkUpdate']>[2],
    context: RequestContext,
  ) {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'inventory:manage');
    const roomType = await this.roomTypeOf(hotel, input.roomTypeId);
    if (roomType.status === 'ARCHIVED')
      throw new AppError(409, 'CONFLICT', 'Archived room categories cannot be changed.');
    const days = await this.deps.inventory.bulkUpdate(hotel, roomType, input);
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'inventory.updated',
      entityType: 'RoomType',
      entityId: input.roomTypeId,
      metadata: {
        from: input.from,
        to: input.to,
        daysOfWeek: input.daysOfWeek ?? [],
        set: input.set,
      },
      context,
    });
    return days;
  }
}
