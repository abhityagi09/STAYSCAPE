import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import {
  hotelContentSchema,
  type AdminHotelSummaryDto,
  type HotelContentInput,
  type HotelDecision,
  type Paginated,
  type PartnerHotelDto,
  type PartnerHotelSummaryDto,
} from '@stayscape/shared';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import { paginated } from '@/lib/http';
import type { RequestContext } from '@/lib/request-context';
import type { AuditService } from '@/modules/audit/audit.service';
import type { CacheService } from '@/modules/catalog/cache.service';
import type { InventoryService } from '@/modules/inventory/inventory.service';
import { toImageDto, type MediaService } from '@/modules/media/media.service';
import type { NotificationService } from '@/modules/notifications/notification.service';
import type { HotelAccess, PartnerAccessService } from '@/modules/partners/partner-access.service';
import { PartnerModel, type PartnerRecord } from '@/modules/partners/partner.model';
import {
  RatePlanModel,
  RoomTypeModel,
  type RatePlanRecord,
  type RoomTypeRecord,
} from '@/modules/rooms/room.models';
import type { AuthContext } from '@/types/express';
import {
  contentDtoToInput,
  coverImage,
  imageMap,
  inputToContent,
  pickContent,
  resolveImages,
  slugify,
  toContentDto,
  workingContent,
  type ContentPatch,
} from './hotel.mapper';
import { HotelModel, type HotelRecord } from './hotel.model';

const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

interface Deps {
  access: PartnerAccessService;
  media: MediaService;
  inventory: InventoryService;
  audit: AuditService;
  notifications: NotificationService;
  cache: CacheService;
}

export class HotelsService {
  constructor(private readonly deps: Deps) {}

  // ------------------------------------------------------------------ shared helpers
  private async completeness(hotel: HotelRecord): Promise<{ ready: boolean; missing: string[] }> {
    const content = workingContent(hotel);
    const missing: string[] = [];
    const parsed = hotelContentSchema.safeParse(contentDtoToInput(toContentDto(content)));
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'details')))];
      missing.push(...fields.map((f) => `Property ${f.replace(/([A-Z])/g, ' $1').toLowerCase()}`));
    }
    if (!content.location) missing.push('Map location');
    if ((content.images ?? []).length < 1) missing.push('At least one photo');
    const roomTypes = await RoomTypeModel.find(
      { hotelId: hotel._id, status: 'ACTIVE', totalInventory: { $gt: 0 } },
      { _id: 1 },
    ).lean<Array<{ _id: Types.ObjectId }>>();
    if (roomTypes.length === 0) missing.push('An active room category with rooms');
    else if (
      !(await RatePlanModel.exists({
        hotelId: hotel._id,
        roomTypeId: { $in: roomTypes.map((r) => r._id) },
        active: true,
      }))
    )
      missing.push('An active rate plan');
    return { ready: missing.length === 0, missing };
  }

  private async toPartnerDto(hotel: HotelRecord): Promise<PartnerHotelDto> {
    const working = workingContent(hotel);
    const ids = [...(working.images ?? []), ...(hotel.images ?? [])].map((i) => i.mediaId);
    const assets = imageMap(await this.deps.media.findImages(ids));
    const changed = hotel.revision?.data ? Object.keys(hotel.revision.data) : [];
    return {
      id: hotel._id.toString(),
      partnerId: hotel.partnerId.toString(),
      slug: hotel.slug,
      publicationStatus: hotel.publicationStatus,
      verificationStatus: hotel.verificationStatus,
      featured: hotel.featuredStatus === 'FEATURED',
      everApproved: hotel.everApproved,
      rejectionReason: hotel.review?.rejectionReason ?? hotel.review?.suspensionReason ?? null,
      revision: {
        status: hotel.revision?.status ?? 'NONE',
        rejectionReason: hotel.revision?.rejectionReason ?? null,
        submittedAt: iso(hotel.revision?.submittedAt),
        changedFields: changed,
      },
      live: toContentDto(pickContent(hotel)),
      working: toContentDto(working),
      images: resolveImages(working.images ?? [], assets),
      completeness: await this.completeness(hotel),
      createdAt: hotel.createdAt.toISOString(),
      updatedAt: hotel.updatedAt.toISOString(),
    };
  }

  private async uniqueSlug(name: string, city: string): Promise<string> {
    const base = slugify(`${name} ${city}`) || 'property';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      if (!(await HotelModel.exists({ slug: candidate }))) return candidate;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }

  private async validateMedia(
    access: HotelAccess | { partner: PartnerRecord; hotel: { _id: Types.ObjectId } },
    patch: ContentPatch,
    current?: HotelRecord,
  ) {
    const images = patch.images ?? (current ? workingContent(current).images : []);
    const ids = images.map((i) => i.mediaId.toString());
    if (new Set(ids).size !== ids.length)
      throw Errors.badRequest('Each photo can only be added once.');
    await this.deps.media.assertOwnedImages(
      access.partner._id.toString(),
      access.hotel._id.toString(),
      ids,
    );
    const cover =
      patch.coverImageId !== undefined
        ? patch.coverImageId
        : current
          ? workingContent(current).coverImageId
          : null;
    if (cover && !ids.includes(cover.toString()))
      throw Errors.badRequest('The cover photo must be one of the property photos.');
    return ids;
  }

  // ------------------------------------------------------------------ partner workspace
  async listForPartner(auth: AuthContext): Promise<PartnerHotelSummaryDto[]> {
    const filter = await this.deps.access.accessibleHotelFilter(auth);
    if (!filter) return [];
    const hotels = await HotelModel.find(filter).sort({ updatedAt: -1 }).lean<HotelRecord[]>();
    const assets = imageMap(
      await this.deps.media.findImages(
        hotels.flatMap((h) =>
          h.coverImageId ? [h.coverImageId] : h.images.slice(0, 1).map((i) => i.mediaId),
        ),
      ),
    );
    const counts = await RoomTypeModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { hotelId: { $in: hotels.map((h) => h._id) }, status: { $ne: 'ARCHIVED' } } },
      { $group: { _id: '$hotelId', n: { $sum: 1 } } },
    ]);
    return hotels.map((h) => ({
      id: h._id.toString(),
      name: workingContent(h).name,
      slug: h.slug,
      city: h.city,
      propertyType: h.propertyType,
      publicationStatus: h.publicationStatus,
      verificationStatus: h.verificationStatus,
      revisionStatus: h.revision?.status ?? 'NONE',
      coverImage: coverImage(h, assets),
      roomTypeCount: counts.find((c) => c._id.equals(h._id))?.n ?? 0,
      updatedAt: h.updatedAt.toISOString(),
    }));
  }

  async create(
    auth: AuthContext,
    input: Partial<HotelContentInput> & { name: string; propertyType: string; city: string },
    context: RequestContext,
  ): Promise<PartnerHotelDto> {
    const partner = await this.deps.access.requireApprovedOwner(auth);
    const content = inputToContent(input);
    if (content.images?.length) throw Errors.badRequest('Add photos after creating the property.');
    let hotel: HotelRecord | null = null;
    for (let attempt = 0; attempt < 3 && !hotel; attempt += 1) {
      try {
        const doc = await HotelModel.create({
          ...content,
          partnerId: partner._id,
          slug: await this.uniqueSlug(input.name, input.city),
          publicationStatus: 'DRAFT',
        });
        hotel = doc.toObject() as HotelRecord;
      } catch (error) {
        if (!isMongoDuplicateKey(error)) throw error;
      }
    }
    if (!hotel)
      throw new AppError(409, 'CONFLICT', 'Could not create a unique listing address. Try again.');
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'hotel.created',
      entityType: 'Hotel',
      entityId: hotel._id.toString(),
      context,
    });
    return this.toPartnerDto(hotel);
  }

  async getForPartner(auth: AuthContext, hotelId: string): Promise<PartnerHotelDto> {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'property:edit');
    return this.toPartnerDto(hotel);
  }

  /**
   * Edit content. Never-approved listings are edited in place (they are not public).
   * Listings that have been approved keep their live content untouched: edits accumulate in a
   * revision that an administrator must approve before it reaches travellers.
   */
  async update(
    auth: AuthContext,
    hotelId: string,
    input: Partial<HotelContentInput>,
    context: RequestContext,
  ): Promise<PartnerHotelDto> {
    const access = await this.deps.access.resolveHotel(auth, hotelId, 'property:edit');
    const { hotel } = access;
    if (['SUBMITTED', 'UNDER_REVIEW'].includes(hotel.publicationStatus))
      throw new AppError(
        409,
        'CONFLICT',
        'This listing is being reviewed and cannot be edited right now.',
      );
    if (hotel.publicationStatus === 'ARCHIVED')
      throw new AppError(409, 'CONFLICT', 'Archived listings cannot be edited.');
    if (hotel.revision?.status === 'SUBMITTED')
      throw new AppError(
        409,
        'CONFLICT',
        'Your changes are awaiting review. Wait for the decision before editing again.',
      );

    const patch = inputToContent(input);
    const imageIds = await this.validateMedia(access, patch, hotel);
    let updated: HotelRecord | null;
    if (hotel.everApproved) {
      const data = { ...((hotel.revision?.data as ContentPatch | null) ?? {}), ...patch };
      updated = await HotelModel.findOneAndUpdate(
        { _id: hotel._id, 'revision.status': { $ne: 'SUBMITTED' } },
        { $set: { revision: { status: 'DRAFT', data, submittedAt: null, rejectionReason: null } } },
        { new: true },
      ).lean<HotelRecord>();
    } else {
      updated = await HotelModel.findOneAndUpdate(
        { _id: hotel._id, publicationStatus: { $in: ['DRAFT', 'REJECTED'] } },
        { $set: patch },
        { new: true, runValidators: true },
      ).lean<HotelRecord>();
    }
    if (!updated)
      throw new AppError(
        409,
        'CONFLICT',
        'The listing changed while saving. Reload and try again.',
      );
    await this.deps.media.markAttached(imageIds);
    await this.deps.audit.record({
      actorId: auth.userId,
      action: hotel.everApproved ? 'hotel.revision_updated' : 'hotel.updated',
      entityType: 'Hotel',
      entityId: hotelId,
      metadata: { fields: Object.keys(patch) },
      context,
    });
    return this.toPartnerDto(updated);
  }

  async submit(
    auth: AuthContext,
    hotelId: string,
    context: RequestContext,
  ): Promise<PartnerHotelDto> {
    const { hotel } = await this.deps.access.requireOwnerOfHotel(auth, hotelId);
    const { ready, missing } = await this.completeness(hotel);
    if (!ready)
      throw Errors.validation(
        { formErrors: missing.map((m) => `Missing: ${m}`) },
        'Complete the listing before submitting it for review.',
      );
    let updated: HotelRecord | null;
    if (hotel.everApproved) {
      if (!hotel.revision || !['DRAFT', 'REJECTED'].includes(hotel.revision.status))
        throw new AppError(409, 'CONFLICT', 'There are no changes to submit.');
      updated = await HotelModel.findOneAndUpdate(
        { _id: hotel._id, 'revision.status': { $in: ['DRAFT', 'REJECTED'] } },
        {
          $set: {
            'revision.status': 'SUBMITTED',
            'revision.submittedAt': new Date(),
            'revision.rejectionReason': null,
          },
        },
        { new: true },
      ).lean<HotelRecord>();
    } else {
      updated = await HotelModel.findOneAndUpdate(
        { _id: hotel._id, publicationStatus: { $in: ['DRAFT', 'REJECTED'] } },
        {
          $set: {
            publicationStatus: 'SUBMITTED',
            'review.submittedAt': new Date(),
            'review.rejectionReason': null,
          },
        },
        { new: true },
      ).lean<HotelRecord>();
    }
    if (!updated)
      throw new AppError(409, 'CONFLICT', 'This listing cannot be submitted in its current state.');
    await this.deps.audit.record({
      actorId: auth.userId,
      action: hotel.everApproved ? 'hotel.revision_submitted' : 'hotel.submitted',
      entityType: 'Hotel',
      entityId: hotelId,
      context,
    });
    return this.toPartnerDto(updated);
  }

  async setPublished(
    auth: AuthContext,
    hotelId: string,
    publish: boolean,
    context: RequestContext,
  ): Promise<PartnerHotelDto> {
    const { hotel } = await this.deps.access.requireOwnerOfHotel(auth, hotelId);
    if (publish) {
      const { ready, missing } = await this.completeness({
        ...hotel,
        revision: { status: 'NONE', data: null, submittedAt: null, rejectionReason: null },
      });
      if (!ready)
        throw Errors.validation({ formErrors: missing }, 'This listing is not ready to publish.');
    }
    const from = publish ? 'APPROVED' : 'PUBLISHED';
    const updated = await HotelModel.findOneAndUpdate(
      { _id: hotel._id, publicationStatus: from },
      { $set: { publicationStatus: publish ? 'PUBLISHED' : 'APPROVED' } },
      { new: true },
    ).lean<HotelRecord>();
    if (!updated)
      throw new AppError(
        409,
        'CONFLICT',
        publish
          ? 'Only approved listings can be published.'
          : 'Only published listings can be unpublished.',
      );
    await this.deps.cache.invalidatePublic();
    await this.deps.audit.record({
      actorId: auth.userId,
      action: publish ? 'hotel.published' : 'hotel.unpublished',
      entityType: 'Hotel',
      entityId: hotelId,
      context,
    });
    return this.toPartnerDto(updated);
  }

  async archive(
    auth: AuthContext,
    hotelId: string,
    context: RequestContext,
  ): Promise<PartnerHotelDto> {
    const { hotel } = await this.deps.access.requireOwnerOfHotel(auth, hotelId);
    if (hotel.publicationStatus === 'SUSPENDED')
      throw new AppError(
        409,
        'CONFLICT',
        'Suspended listings cannot be archived. Contact support.',
      );
    if (await this.deps.inventory.hasFutureCommitments(hotel))
      throw new AppError(
        409,
        'CONFLICT',
        'This property has upcoming reservations or holds and cannot be archived.',
      );
    const updated = await HotelModel.findOneAndUpdate(
      { _id: hotel._id, publicationStatus: { $nin: ['ARCHIVED', 'SUSPENDED'] } },
      { $set: { publicationStatus: 'ARCHIVED', archivedAt: new Date() } },
      { new: true },
    ).lean<HotelRecord>();
    if (!updated) throw new AppError(409, 'CONFLICT', 'This listing cannot be archived.');
    await this.deps.cache.invalidatePublic();
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'hotel.archived',
      entityType: 'Hotel',
      entityId: hotelId,
      context,
    });
    return this.toPartnerDto(updated);
  }

  async uploadImage(
    auth: AuthContext,
    hotelId: string,
    purpose: 'HOTEL_IMAGE' | 'ROOM_IMAGE',
    file: Parameters<MediaService['uploadImage']>[0]['file'],
  ) {
    const need = purpose === 'ROOM_IMAGE' ? 'rooms:manage' : 'property:edit';
    const { hotel, partner } = await this.deps.access.resolveHotel(auth, hotelId, need);
    if (hotel.publicationStatus === 'ARCHIVED')
      throw new AppError(409, 'CONFLICT', 'Archived listings cannot be changed.');
    const asset = await this.deps.media.uploadImage({
      partnerId: partner._id.toString(),
      hotelId,
      uploadedBy: auth.userId,
      purpose,
      file,
    });
    return toImageDto(asset);
  }

  /** Delete an image only when neither the live listing, the pending revision nor a room uses it. */
  async deleteImage(
    auth: AuthContext,
    hotelId: string,
    mediaId: string,
    context: RequestContext,
  ): Promise<void> {
    const { hotel, partner } = await this.deps.access.resolveHotel(auth, hotelId, 'property:edit');
    const referenced =
      hotel.images.some((i) => i.mediaId.toString() === mediaId) ||
      (workingContent(hotel).images ?? []).some((i) => i.mediaId.toString() === mediaId) ||
      Boolean(await RoomTypeModel.exists({ hotelId: hotel._id, 'images.mediaId': mediaId }));
    if (referenced)
      throw new AppError(
        409,
        'CONFLICT',
        'Remove this photo from the listing (and save) before deleting it.',
      );
    await this.deps.media.deleteAsset(partner._id.toString(), mediaId);
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'media.deleted',
      entityType: 'MediaAsset',
      entityId: mediaId,
      context,
    });
  }

  // ------------------------------------------------------------------ administration
  async listForAdmin(query: {
    page: number;
    limit: number;
    status?: string | undefined;
    revision?: string | undefined;
    search?: string | undefined;
  }): Promise<Paginated<AdminHotelSummaryDto>> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.publicationStatus = query.status;
    if (query.revision) filter['revision.status'] = query.revision;
    if (query.search) filter.name = new RegExp(escapeRegex(query.search), 'i');
    const [items, total] = await Promise.all([
      HotelModel.find(filter, {
        name: 1,
        slug: 1,
        city: 1,
        partnerId: 1,
        publicationStatus: 1,
        revision: 1,
        featuredStatus: 1,
        review: 1,
        updatedAt: 1,
      })
        .sort({ 'review.submittedAt': 1, updatedAt: -1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean<HotelRecord[]>(),
      HotelModel.countDocuments(filter),
    ]);
    const partners = await PartnerModel.find(
      { _id: { $in: items.map((h) => h.partnerId) } },
      { businessName: 1 },
    ).lean<PartnerRecord[]>();
    return paginated(
      items.map((h) => ({
        id: h._id.toString(),
        name: h.name,
        slug: h.slug,
        city: h.city,
        partnerName: partners.find((p) => p._id.equals(h.partnerId))?.businessName ?? null,
        publicationStatus: h.publicationStatus,
        revisionStatus: h.revision?.status ?? 'NONE',
        featured: h.featuredStatus === 'FEATURED',
        submittedAt: iso(
          h.revision?.status === 'SUBMITTED' ? h.revision.submittedAt : h.review?.submittedAt,
        ),
        updatedAt: h.updatedAt.toISOString(),
      })),
      query.page,
      query.limit,
      total,
    );
  }

  async getForAdmin(hotelId: string): Promise<
    PartnerHotelDto & {
      partner: { id: string; businessName: string | null; verificationStatus: string };
      roomTypes: RoomTypeRecord[];
      ratePlans: RatePlanRecord[];
    }
  > {
    if (!Types.ObjectId.isValid(hotelId)) throw Errors.notFound('Property');
    const hotel = await HotelModel.findById(hotelId).lean<HotelRecord>();
    if (!hotel) throw Errors.notFound('Property');
    const partner = await PartnerModel.findById(hotel.partnerId).lean<PartnerRecord>();
    const [roomTypes, ratePlans] = await Promise.all([
      RoomTypeModel.find({ hotelId: hotel._id }).lean<RoomTypeRecord[]>(),
      RatePlanModel.find({ hotelId: hotel._id }).lean<RatePlanRecord[]>(),
    ]);
    return {
      ...(await this.toPartnerDto(hotel)),
      partner: {
        id: hotel.partnerId.toString(),
        businessName: partner?.businessName ?? null,
        verificationStatus: partner?.verificationStatus ?? 'UNKNOWN',
      },
      roomTypes,
      ratePlans,
    };
  }

  async decide(
    actor: { userId: string },
    hotelId: string,
    decision: HotelDecision,
    context: RequestContext,
  ): Promise<PartnerHotelDto> {
    if (!Types.ObjectId.isValid(hotelId)) throw Errors.notFound('Property');
    const hotel = await HotelModel.findById(hotelId).lean<HotelRecord>();
    if (!hotel) throw Errors.notFound('Property');
    const partner = await PartnerModel.findById(hotel.partnerId).lean<PartnerRecord>();
    if (partner?.ownerId.toString() === actor.userId)
      throw Errors.forbidden('You cannot review your own property.');
    const reviewed = {
      'review.reviewedBy': new Types.ObjectId(actor.userId),
      'review.reviewedAt': new Date(),
    };
    const conflict = () =>
      new AppError(
        409,
        'CONFLICT',
        `This action is not allowed while the listing is ${hotel.publicationStatus.toLowerCase().replace('_', ' ')}.`,
      );
    let filter: Record<string, unknown> = { _id: hotel._id };
    let update: Record<string, unknown>;
    let notify: {
      type: 'PROPERTY_APPROVED' | 'PROPERTY_REJECTED' | 'PROPERTY_SUSPENDED';
      title: string;
      body: string;
    } | null = null;

    switch (decision.decision) {
      case 'START_REVIEW':
        filter = { ...filter, publicationStatus: 'SUBMITTED' };
        update = { $set: { publicationStatus: 'UNDER_REVIEW', ...reviewed } };
        break;
      case 'APPROVE':
        if (partner?.verificationStatus !== 'APPROVED')
          throw new AppError(409, 'CONFLICT', 'The partner account must be approved first.');
        filter = { ...filter, publicationStatus: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } };
        update = {
          $set: {
            publicationStatus: 'APPROVED',
            verificationStatus: 'VERIFIED',
            everApproved: true,
            'review.rejectionReason': null,
            ...reviewed,
          },
        };
        notify = {
          type: 'PROPERTY_APPROVED',
          title: `${hotel.name} approved`,
          body: 'Your listing is approved. Publish it to make it visible in search.',
        };
        break;
      case 'REJECT':
        filter = { ...filter, publicationStatus: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } };
        update = {
          $set: {
            publicationStatus: 'REJECTED',
            verificationStatus: 'REJECTED',
            'review.rejectionReason': decision.reason,
            ...reviewed,
          },
        };
        notify = {
          type: 'PROPERTY_REJECTED',
          title: `${hotel.name} needs changes`,
          body: decision.reason,
        };
        break;
      case 'APPROVE_REVISION': {
        if (hotel.revision?.status !== 'SUBMITTED' || !hotel.revision.data)
          throw new AppError(409, 'CONFLICT', 'There is no submitted revision.');
        filter = { ...filter, 'revision.status': 'SUBMITTED' };
        update = {
          $set: {
            ...(hotel.revision.data as ContentPatch),
            revision: { status: 'NONE', data: null, submittedAt: null, rejectionReason: null },
            ...reviewed,
          },
        };
        notify = {
          type: 'PROPERTY_APPROVED',
          title: `Changes to ${hotel.name} approved`,
          body: 'Your updates are now live.',
        };
        break;
      }
      case 'REJECT_REVISION':
        filter = { ...filter, 'revision.status': 'SUBMITTED' };
        update = {
          $set: {
            'revision.status': 'REJECTED',
            'revision.rejectionReason': decision.reason,
            ...reviewed,
          },
        };
        notify = {
          type: 'PROPERTY_REJECTED',
          title: `Changes to ${hotel.name} not approved`,
          body: decision.reason,
        };
        break;
      case 'SUSPEND':
        filter = { ...filter, publicationStatus: { $in: ['APPROVED', 'PUBLISHED'] } };
        update = {
          $set: {
            publicationStatus: 'SUSPENDED',
            'review.suspensionReason': decision.reason,
            ...reviewed,
          },
        };
        notify = {
          type: 'PROPERTY_SUSPENDED',
          title: `${hotel.name} suspended`,
          body: decision.reason,
        };
        break;
      case 'REINSTATE':
        if (partner?.verificationStatus !== 'APPROVED')
          throw new AppError(409, 'CONFLICT', 'Reinstate the partner account first.');
        filter = { ...filter, publicationStatus: 'SUSPENDED' };
        update = {
          $set: { publicationStatus: 'APPROVED', 'review.suspensionReason': null, ...reviewed },
        };
        break;
      case 'FEATURE':
        filter = { ...filter, publicationStatus: { $in: ['APPROVED', 'PUBLISHED'] } };
        update = { $set: { featuredStatus: decision.featured ? 'FEATURED' : 'NONE' } };
        break;
    }
    const updated = await HotelModel.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
    }).lean<HotelRecord>();
    if (!updated) throw conflict();
    await this.deps.cache.invalidatePublic();
    if (notify && partner)
      await this.deps.notifications.notifyInApp({
        userId: partner.ownerId.toString(),
        ...notify,
        resource: { type: 'Hotel', id: hotelId },
      });
    await this.deps.audit.record({
      actorId: actor.userId,
      action: `hotel.${decision.decision.toLowerCase()}`,
      entityType: 'Hotel',
      entityId: hotelId,
      metadata: {
        from: hotel.publicationStatus,
        to: updated.publicationStatus,
        reason: 'reason' in decision ? decision.reason : null,
      },
      context,
    });
    return this.toPartnerDto(updated);
  }
}
