import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  PARTNER_DOCUMENT_LABELS,
  PARTNER_EDITABLE_STATUSES,
  REQUIRED_PARTNER_DOCUMENTS,
  partnerBusinessSchema,
  partnerContactSchema,
  partnerTaxSchema,
  type AdminPartnerSummaryDto,
  type Paginated,
  type PartnerApplicationDto,
  type PartnerDocumentType,
  type PartnerDraftInput,
  type PartnerReviewDecision,
  type Role,
  type StaffDto,
  type StaffPermission,
} from '@stayscape/shared';
import { AppError, Errors } from '@/lib/errors';
import type { FieldEncryptor } from '@/lib/field-encryption';
import { paginated } from '@/lib/http';
import type { RequestContext } from '@/lib/request-context';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import type { CacheService } from '@/modules/catalog/cache.service';
import { HotelModel } from '@/modules/hotels/hotel.model';
import type { MediaService, UploadedFile } from '@/modules/media/media.service';
import type { NotificationService } from '@/modules/notifications/notification.service';
import { UserModel, type UserRecord } from '@/modules/users/user.model';
import {
  PartnerModel,
  PartnerStaffModel,
  type PartnerRecord,
  type PartnerStaffRecord,
} from './partner.model';

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function missingRequirements(partner: PartnerRecord): string[] {
  const missing: string[] = [];
  const business = {
    businessName: partner.businessName,
    businessType: partner.businessType,
    ownerName: partner.ownerName,
  };
  if (!partnerBusinessSchema.safeParse(business).success)
    missing.push('Owner and business information');
  if (
    !partnerContactSchema.safeParse({
      businessAddress: partner.businessAddress,
      contactDetails: partner.contactDetails,
    }).success
  )
    missing.push('Business address and contact details');
  if (
    !partnerTaxSchema.safeParse({
      registrationNumber: partner.registrationNumber,
      taxDetails: { pan: partner.taxDetails?.pan, gstin: partner.taxDetails?.gstin ?? '' },
    }).success
  )
    missing.push('Registration and tax information');
  for (const type of REQUIRED_PARTNER_DOCUMENTS) {
    if (!partner.verificationDocuments.some((d) => d.type === type))
      missing.push(PARTNER_DOCUMENT_LABELS[type]);
  }
  if (!partner.settlementAccount) missing.push('Settlement bank account');
  return missing;
}

export function toApplicationDto(partner: PartnerRecord): PartnerApplicationDto {
  const contactDetails = { ...partner.contactDetails };
  return {
    id: partner._id.toString(),
    ownerId: partner.ownerId.toString(),
    verificationStatus: partner.verificationStatus,
    business: {
      ...(partner.businessName ? { businessName: partner.businessName } : {}),
      ...(partner.businessType ? { businessType: partner.businessType } : {}),
      ...(partner.ownerName ? { ownerName: partner.ownerName } : {}),
    },
    contact: { businessAddress: { ...partner.businessAddress }, contactDetails },
    tax: {
      ...(partner.registrationNumber ? { registrationNumber: partner.registrationNumber } : {}),
      taxDetails: {
        ...(partner.taxDetails?.pan ? { pan: partner.taxDetails.pan } : {}),
        ...(partner.taxDetails?.gstin ? { gstin: partner.taxDetails.gstin } : {}),
      },
    },
    settlementAccount: partner.settlementAccount
      ? {
          reference: partner.settlementAccount.reference,
          accountHolderName: partner.settlementAccount.accountHolderName,
          bankName: partner.settlementAccount.bankName,
          ifsc: partner.settlementAccount.ifsc,
          accountNumberLast4: partner.settlementAccount.accountNumberLast4,
        }
      : null,
    documents: partner.verificationDocuments.map((d) => ({
      id: d.mediaId.toString(),
      type: d.type,
      fileName: d.fileName,
      contentType: d.contentType,
      size: d.size,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
    missingRequirements: missingRequirements(partner),
    rejectionReason: partner.rejectionReason,
    submittedAt: iso(partner.submittedAt),
    approvedAt: iso(partner.approvedAt),
    createdAt: partner.createdAt.toISOString(),
    updatedAt: partner.updatedAt.toISOString(),
  };
}

interface Deps {
  media: MediaService;
  audit: AuditService;
  notifications: NotificationService;
  encryptor: FieldEncryptor;
  cache: CacheService;
}

export class PartnersService {
  constructor(private readonly deps: Deps) {}

  private async editable(userId: string): Promise<PartnerRecord> {
    const partner = await PartnerModel.findOne({ ownerId: userId }).lean<PartnerRecord>();
    if (!partner) throw Errors.notFound('Partner application');
    if (!PARTNER_EDITABLE_STATUSES.includes(partner.verificationStatus)) {
      throw new AppError(409, 'CONFLICT', 'This application can no longer be edited.');
    }
    return partner;
  }

  async getMine(userId: string): Promise<PartnerApplicationDto | null> {
    const partner = await PartnerModel.findOne({ ownerId: userId }).lean<PartnerRecord>();
    return partner ? toApplicationDto(partner) : null;
  }

  /** Create or update the draft. Present sections are validated; absent ones are left as-is. */
  async saveDraft(
    userId: string,
    input: PartnerDraftInput,
    context: RequestContext,
  ): Promise<PartnerApplicationDto> {
    let partner = await PartnerModel.findOne({ ownerId: userId }).lean<PartnerRecord>();
    if (!partner) {
      try {
        partner = (
          await PartnerModel.create({ ownerId: new Types.ObjectId(userId) })
        ).toObject() as PartnerRecord;
        await this.deps.audit.record({
          actorId: userId,
          action: 'partner.application_started',
          entityType: 'Partner',
          entityId: partner._id.toString(),
          context,
        });
      } catch {
        partner = await PartnerModel.findOne({ ownerId: userId }).lean<PartnerRecord>(); // concurrent create
      }
    }
    if (!partner) throw Errors.notFound('Partner application');
    if (!PARTNER_EDITABLE_STATUSES.includes(partner.verificationStatus))
      throw new AppError(409, 'CONFLICT', 'This application can no longer be edited.');

    const set: Record<string, unknown> = {};
    const { business, contact, tax, settlementAccount } = input;
    if (business?.businessName !== undefined) set.businessName = business.businessName;
    if (business?.businessType !== undefined) set.businessType = business.businessType;
    if (business?.ownerName !== undefined) set.ownerName = business.ownerName;
    for (const [key, value] of Object.entries(contact?.businessAddress ?? {}))
      if (value !== undefined) set[`businessAddress.${key}`] = value;
    for (const [key, value] of Object.entries(contact?.contactDetails ?? {}))
      if (value !== undefined) set[`contactDetails.${key}`] = value;
    if (tax?.registrationNumber !== undefined) set.registrationNumber = tax.registrationNumber;
    if (tax?.taxDetails?.pan !== undefined) set['taxDetails.pan'] = tax.taxDetails.pan;
    if (tax?.taxDetails?.gstin !== undefined)
      set['taxDetails.gstin'] = tax.taxDetails.gstin || null;
    if (settlementAccount) {
      const reference =
        partner.settlementAccount?.reference ?? `sa_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      set.settlementAccount = {
        reference,
        accountHolderName: settlementAccount.accountHolderName,
        bankName: settlementAccount.bankName,
        ifsc: settlementAccount.ifsc,
        accountNumberLast4: settlementAccount.accountNumber.slice(-4),
        accountNumberEncrypted: this.deps.encryptor.encrypt(settlementAccount.accountNumber),
      };
      set.settlementAccountReference = reference;
    }
    const updated = await PartnerModel.findByIdAndUpdate(
      partner._id,
      { $set: set },
      { new: true, runValidators: true },
    ).lean<PartnerRecord>();
    if (!updated) throw Errors.notFound('Partner application');
    if (settlementAccount) {
      await this.deps.audit.record({
        actorId: userId,
        action: 'partner.settlement_account_updated',
        entityType: 'Partner',
        entityId: updated._id.toString(),
        metadata: { last4: settlementAccount.accountNumber.slice(-4) },
        context,
      });
    }
    return toApplicationDto(updated);
  }

  async uploadDocument(
    userId: string,
    type: PartnerDocumentType,
    file: UploadedFile | undefined,
    context: RequestContext,
  ): Promise<PartnerApplicationDto> {
    const partner = await this.editable(userId);
    const asset = await this.deps.media.uploadDocument({
      partnerId: partner._id.toString(),
      uploadedBy: userId,
      file,
    });
    const previous = partner.verificationDocuments.filter((d) => d.type === type);
    const updated = await PartnerModel.findByIdAndUpdate(
      partner._id,
      {
        $pull: { verificationDocuments: { type } },
      },
      { new: true },
    ).lean<PartnerRecord>();
    const final = await PartnerModel.findByIdAndUpdate(
      partner._id,
      {
        $push: {
          verificationDocuments: {
            type,
            mediaId: asset._id,
            fileName: asset.originalFileName,
            contentType: asset.contentType,
            size: asset.size,
            uploadedAt: new Date(),
          },
        },
      },
      { new: true },
    ).lean<PartnerRecord>();
    if (!updated || !final) throw Errors.notFound('Partner application');
    for (const doc of previous)
      await this.deps.media
        .deleteAsset(partner._id.toString(), doc.mediaId.toString())
        .catch(() => undefined);
    await this.deps.audit.record({
      actorId: userId,
      action: 'partner.document_uploaded',
      entityType: 'Partner',
      entityId: partner._id.toString(),
      metadata: { type },
      context,
    });
    return toApplicationDto(final);
  }

  async removeDocument(userId: string, mediaId: string): Promise<PartnerApplicationDto> {
    const partner = await this.editable(userId);
    if (!partner.verificationDocuments.some((d) => d.mediaId.toString() === mediaId))
      throw Errors.notFound('Document');
    const updated = await PartnerModel.findByIdAndUpdate(
      partner._id,
      { $pull: { verificationDocuments: { mediaId: new Types.ObjectId(mediaId) } } },
      { new: true },
    ).lean<PartnerRecord>();
    await this.deps.media.deleteAsset(partner._id.toString(), mediaId).catch(() => undefined);
    return toApplicationDto(updated as PartnerRecord);
  }

  async readOwnDocument(userId: string, mediaId: string) {
    const partner = await PartnerModel.findOne({ ownerId: userId }).lean<PartnerRecord>();
    if (!partner) throw Errors.notFound('Document');
    return this.deps.media.readDocument(partner._id.toString(), mediaId);
  }

  async submit(userId: string, context: RequestContext): Promise<PartnerApplicationDto> {
    const partner = await this.editable(userId);
    const missing = missingRequirements(partner);
    if (missing.length)
      throw Errors.validation(
        { formErrors: missing.map((m) => `Missing: ${m}`) },
        'Complete every step before submitting.',
      );
    const updated = await PartnerModel.findOneAndUpdate(
      { _id: partner._id, verificationStatus: { $in: PARTNER_EDITABLE_STATUSES } },
      {
        $set: {
          verificationStatus: 'UNDER_REVIEW',
          submittedAt: new Date(),
          rejectionReason: null,
        },
      },
      { new: true },
    ).lean<PartnerRecord>();
    if (!updated) throw new AppError(409, 'CONFLICT', 'This application was already submitted.');
    await this.deps.audit.record({
      actorId: userId,
      action: 'partner.application_submitted',
      entityType: 'Partner',
      entityId: partner._id.toString(),
      context,
    });
    await this.deps.notifications.notifyInApp({
      userId,
      type: 'PARTNER_SUBMITTED',
      title: 'Application submitted',
      body: 'Our team is reviewing your partner application.',
    });
    return toApplicationDto(updated);
  }

  // ---------------------------------------------------------------- administration
  async list(query: {
    page: number;
    limit: number;
    status?: string | undefined;
    search?: string | undefined;
  }): Promise<Paginated<AdminPartnerSummaryDto>> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.verificationStatus = query.status;
    if (query.search) filter.businessName = new RegExp(escapeRegex(query.search), 'i');
    const [items, total] = await Promise.all([
      PartnerModel.find(filter)
        .sort({ submittedAt: -1, createdAt: -1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean<PartnerRecord[]>(),
      PartnerModel.countDocuments(filter),
    ]);
    const owners = await UserModel.find({ _id: { $in: items.map((p) => p.ownerId) } }).lean<
      UserRecord[]
    >();
    const counts = await HotelModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { partnerId: { $in: items.map((p) => p._id) } } },
      { $group: { _id: '$partnerId', n: { $sum: 1 } } },
    ]);
    return paginated(
      items.map((p) => {
        const owner = owners.find((o) => o._id.equals(p.ownerId));
        return {
          id: p._id.toString(),
          businessName: p.businessName,
          ownerEmail: owner?.email ?? '',
          ownerName: owner ? `${owner.firstName} ${owner.lastName}` : '',
          verificationStatus: p.verificationStatus,
          city: p.businessAddress?.city ?? null,
          submittedAt: iso(p.submittedAt),
          hotelCount: counts.find((c) => c._id.equals(p._id))?.n ?? 0,
          createdAt: p.createdAt.toISOString(),
        };
      }),
      query.page,
      query.limit,
      total,
    );
  }

  async getForAdmin(
    id: string,
  ): Promise<PartnerApplicationDto & { owner: { id: string; email: string; name: string } }> {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Partner');
    const partner = await PartnerModel.findById(id).lean<PartnerRecord>();
    if (!partner) throw Errors.notFound('Partner');
    const owner = await UserModel.findById(partner.ownerId).lean<UserRecord>();
    return {
      ...toApplicationDto(partner),
      owner: {
        id: partner.ownerId.toString(),
        email: owner?.email ?? '',
        name: owner ? `${owner.firstName} ${owner.lastName}` : '',
      },
    };
  }

  readDocumentForAdmin(partnerId: string, mediaId: string) {
    if (!Types.ObjectId.isValid(partnerId)) throw Errors.notFound('Document');
    return this.deps.media.readDocument(partnerId, mediaId);
  }

  async decide(
    actor: { userId: string },
    id: string,
    decision: PartnerReviewDecision,
    context: RequestContext,
  ): Promise<PartnerApplicationDto> {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Partner');
    const partner = await PartnerModel.findById(id).lean<PartnerRecord>();
    if (!partner) throw Errors.notFound('Partner');
    const ownerId = partner.ownerId.toString();
    if (ownerId === actor.userId)
      throw Errors.forbidden('You cannot review your own partner application.');

    const transition = (from: string[], to: string) => {
      if (!from.includes(partner.verificationStatus))
        throw new AppError(
          409,
          'CONFLICT',
          `Cannot ${decision.decision.toLowerCase().replace('_', ' ')} an application that is ${partner.verificationStatus.toLowerCase().replace('_', ' ')}.`,
        );
      return to;
    };

    let updated: PartnerRecord | null = null;
    switch (decision.decision) {
      case 'APPROVE': {
        transition(['UNDER_REVIEW', 'SUSPENDED'], 'APPROVED');
        updated = await withTransaction(async (session) => {
          const result = await PartnerModel.findOneAndUpdate(
            { _id: partner._id, verificationStatus: partner.verificationStatus },
            {
              $set: {
                verificationStatus: 'APPROVED',
                approvedBy: new Types.ObjectId(actor.userId),
                approvedAt: new Date(),
                rejectionReason: null,
              },
            },
            { new: true, session },
          ).lean<PartnerRecord>();
          if (!result)
            throw new AppError(409, 'CONFLICT', 'The application changed; reload and try again.');
          await UserModel.updateOne(
            { _id: partner.ownerId },
            { $addToSet: { roles: 'HOTEL_OWNER' satisfies Role } },
            { session },
          );
          return result;
        });
        await this.deps.notifications.notifyInApp({
          userId: ownerId,
          type: 'PARTNER_APPROVED',
          title: 'Partner account approved',
          body: 'You can now create and manage properties on STAYSCAPE.',
        });
        break;
      }
      case 'REJECT':
      case 'REQUEST_DOCUMENTS': {
        const to = transition(
          ['UNDER_REVIEW'],
          decision.decision === 'REJECT' ? 'REJECTED' : 'DOCUMENTS_PENDING',
        );
        updated = await PartnerModel.findOneAndUpdate(
          { _id: partner._id, verificationStatus: 'UNDER_REVIEW' },
          { $set: { verificationStatus: to, rejectionReason: decision.reason } },
          { new: true },
        ).lean<PartnerRecord>();
        await this.deps.notifications.notifyInApp({
          userId: ownerId,
          type: decision.decision === 'REJECT' ? 'PARTNER_REJECTED' : 'PARTNER_DOCUMENTS_REQUESTED',
          title:
            decision.decision === 'REJECT'
              ? 'Partner application not approved'
              : 'More documents needed',
          body: decision.reason,
        });
        break;
      }
      case 'SUSPEND': {
        transition(['APPROVED'], 'SUSPENDED');
        updated = await PartnerModel.findOneAndUpdate(
          { _id: partner._id, verificationStatus: 'APPROVED' },
          { $set: { verificationStatus: 'SUSPENDED', rejectionReason: decision.reason } },
          { new: true },
        ).lean<PartnerRecord>();
        // Suspended partners disappear from public search immediately.
        await HotelModel.updateMany(
          { partnerId: partner._id, publicationStatus: { $in: ['PUBLISHED', 'APPROVED'] } },
          {
            $set: {
              publicationStatus: 'SUSPENDED',
              'review.suspensionReason': 'Partner account suspended',
            },
          },
        );
        await this.deps.cache.invalidatePublic();
        await this.deps.notifications.notifyInApp({
          userId: ownerId,
          type: 'PARTNER_SUSPENDED',
          title: 'Partner account suspended',
          body: decision.reason,
        });
        break;
      }
    }
    if (!updated)
      throw new AppError(409, 'CONFLICT', 'The application changed; reload and try again.');
    await this.deps.audit.record({
      actorId: actor.userId,
      action: `partner.${decision.decision.toLowerCase()}`,
      entityType: 'Partner',
      entityId: id,
      metadata: {
        from: partner.verificationStatus,
        to: updated.verificationStatus,
        reason: 'reason' in decision ? decision.reason : null,
      },
      context,
    });
    return toApplicationDto(updated);
  }

  // ---------------------------------------------------------------- staff
  private async toStaffDtos(records: PartnerStaffRecord[]): Promise<StaffDto[]> {
    const users = await UserModel.find({ _id: { $in: records.map((r) => r.userId) } }).lean<
      UserRecord[]
    >();
    return records.map((r) => {
      const user = users.find((u) => u._id.equals(r.userId));
      return {
        id: r._id.toString(),
        userId: r.userId.toString(),
        email: user?.email ?? '',
        name: user ? `${user.firstName} ${user.lastName}` : '',
        permissions: r.permissions,
        assignedProperties: r.assignedProperties.map(String),
        invitationStatus: r.invitationStatus,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async listStaff(partner: PartnerRecord): Promise<StaffDto[]> {
    return this.toStaffDtos(
      await PartnerStaffModel.find({
        partnerId: partner._id,
        invitationStatus: { $ne: 'REVOKED' },
      }).lean<PartnerStaffRecord[]>(),
    );
  }

  async inviteStaff(
    partner: PartnerRecord,
    actorId: string,
    input: { email: string; assignedProperties: string[]; permissions: StaffPermission[] },
    context: RequestContext,
  ): Promise<StaffDto> {
    const user = await UserModel.findOne({ email: input.email }).lean<UserRecord>();
    if (!user) throw Errors.notFound('A STAYSCAPE account with that email');
    if (user._id.equals(partner.ownerId))
      throw Errors.badRequest('You already own this partner account.');
    const owned = await HotelModel.countDocuments({
      _id: { $in: input.assignedProperties },
      partnerId: partner._id,
    });
    if (owned !== new Set(input.assignedProperties).size)
      throw Errors.badRequest('Assigned properties must belong to your partner account.');
    const record = await PartnerStaffModel.findOneAndUpdate(
      { partnerId: partner._id, userId: user._id },
      {
        $set: {
          assignedProperties: input.assignedProperties.map((id) => new Types.ObjectId(id)),
          permissions: input.permissions,
          invitedBy: new Types.ObjectId(actorId),
          invitationStatus: 'PENDING',
        },
      },
      { upsert: true, new: true },
    ).lean<PartnerStaffRecord>();
    await this.deps.notifications.notifyInApp({
      userId: user._id.toString(),
      type: 'STAFF_INVITATION',
      title: 'Property team invitation',
      body: `${partner.businessName ?? 'A partner'} invited you to help manage their properties.`,
      resource: { type: 'PartnerStaff', id: record!._id.toString() },
    });
    await this.deps.audit.record({
      actorId,
      action: 'partner.staff_invited',
      entityType: 'PartnerStaff',
      entityId: record!._id.toString(),
      metadata: { permissions: input.permissions },
      context,
    });
    return (await this.toStaffDtos([record!]))[0]!;
  }

  async revokeStaff(
    partner: PartnerRecord,
    staffId: string,
    actorId: string,
    context: RequestContext,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(staffId)) throw Errors.notFound('Team member');
    const record = await PartnerStaffModel.findOneAndUpdate(
      { _id: staffId, partnerId: partner._id },
      { $set: { invitationStatus: 'REVOKED' } },
    ).lean<PartnerStaffRecord>();
    if (!record) throw Errors.notFound('Team member');
    await this.deps.audit.record({
      actorId,
      action: 'partner.staff_revoked',
      entityType: 'PartnerStaff',
      entityId: staffId,
      context,
    });
  }

  async myInvitations(userId: string): Promise<Array<StaffDto & { partnerName: string | null }>> {
    const records = await PartnerStaffModel.find({ userId, invitationStatus: 'PENDING' }).lean<
      PartnerStaffRecord[]
    >();
    const partners = await PartnerModel.find({
      _id: { $in: records.map((r) => r.partnerId) },
    }).lean<PartnerRecord[]>();
    const dtos = await this.toStaffDtos(records);
    return dtos.map((dto, i) => ({
      ...dto,
      partnerName: partners.find((p) => p._id.equals(records[i]!.partnerId))?.businessName ?? null,
    }));
  }

  async acceptInvitation(
    userId: string,
    invitationId: string,
    context: RequestContext,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(invitationId)) throw Errors.notFound('Invitation');
    await withTransaction(async (session) => {
      const record = await PartnerStaffModel.findOneAndUpdate(
        { _id: invitationId, userId, invitationStatus: 'PENDING' },
        { $set: { invitationStatus: 'ACCEPTED' } },
        { session, new: true },
      );
      if (!record) throw Errors.notFound('Invitation');
      await UserModel.updateOne(
        { _id: userId },
        { $addToSet: { roles: 'HOTEL_STAFF' satisfies Role } },
        { session },
      );
    });
    await this.deps.audit.record({
      actorId: userId,
      action: 'partner.staff_accepted',
      entityType: 'PartnerStaff',
      entityId: invitationId,
      context,
    });
  }
}
