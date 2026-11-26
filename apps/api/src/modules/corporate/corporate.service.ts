import { createHash, randomBytes } from 'node:crypto';
import { Schema, Types, model } from 'mongoose';
import { diffDays, todayInTimeZone, type OrgRole } from '@stayscape/shared';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import { paginated } from '@/lib/http';
import type { RequestContext } from '@/lib/request-context';
import type { AuditService } from '@/modules/audit/audit.service';
import { BookingModel, type BookingRecord } from '@/modules/bookings/booking.models';
import type { DocumentsService } from '@/modules/documents/documents.service';
import { HotelModel, type HotelRecord } from '@/modules/hotels/hotel.model';
import type { NotificationService } from '@/modules/notifications/notification.service';
import type { QuoteService } from '@/modules/pricing/quote.service';
import { UserModel } from '@/modules/users/user.model';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

// ------------------------------------------------------------------ models
export interface TravelPolicy {
  maxNightlyMinor: number | null;
  maxStarCategory: number | null;
  allowedCities: string[];
  minAdvanceDays: number;
  approvalRequiredAboveMinor: number | null;
  monthlyBudgetMinor: number | null;
}
const DEFAULT_POLICY: TravelPolicy = {
  maxNightlyMinor: null,
  maxStarCategory: null,
  allowedCities: [],
  minAdvanceDays: 0,
  approvalRequiredAboveMinor: null,
  monthlyBudgetMinor: null,
};
interface OrganizationAttrs {
  name: string;
  billingEmail: string;
  gstin: string | null;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
  statusReason: string | null;
  policy: TravelPolicy;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
type OrganizationRecord = OrganizationAttrs & { _id: Types.ObjectId };
const orgSchema = new Schema<OrganizationAttrs>(
  {
    name: { type: String, required: true, maxlength: 120 },
    billingEmail: { type: String, required: true },
    gstin: { type: String, default: null },
    status: {
      type: String,
      enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'],
      default: 'PENDING_VERIFICATION',
    },
    statusReason: { type: String, default: null },
    policy: { type: Schema.Types.Mixed, default: () => ({ ...DEFAULT_POLICY }) },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);
orgSchema.index({ status: 1, createdAt: -1 }, { name: 'status_created' });
export const OrganizationModel = model<OrganizationAttrs>('Organization', orgSchema);

interface OrgMemberAttrs {
  orgId: Types.ObjectId;
  userId: Types.ObjectId;
  role: OrgRole;
  department: string;
  createdAt: Date;
}
type OrgMemberRecord = OrgMemberAttrs & { _id: Types.ObjectId };
const memberSchema = new Schema<OrgMemberAttrs>(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, required: true },
    department: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);
// One organisation per person keeps corporate and personal data cleanly separated.
memberSchema.index({ userId: 1 }, { unique: true, name: 'uniq_user' });
memberSchema.index({ orgId: 1, role: 1 }, { name: 'org_role' });
export const OrgMemberModel = model<OrgMemberAttrs>('OrgMember', memberSchema);

interface OrgInvitationAttrs {
  orgId: Types.ObjectId;
  email: string;
  role: OrgRole;
  department: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  invitedBy: Types.ObjectId;
}
const inviteSchema = new Schema<OrgInvitationAttrs>(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    email: { type: String, required: true },
    role: { type: String, required: true },
    department: { type: String, default: '' },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    invitedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, versionKey: false },
);
inviteSchema.index({ tokenHash: 1 }, { unique: true, name: 'uniq_token' });
export const OrgInvitationModel = model<OrgInvitationAttrs>('OrgInvitation', inviteSchema);

type RequestStatus = 'PENDING' | 'APPROVED' | 'AUTO_APPROVED' | 'REJECTED' | 'BOOKED';
interface TravelRequestAttrs {
  orgId: Types.ObjectId;
  employeeId: Types.ObjectId;
  hotelId: Types.ObjectId;
  hotelName: string;
  city: string;
  roomTypeId: Types.ObjectId;
  ratePlanId: Types.ObjectId;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
  purpose: string;
  quotedTotalMinor: number;
  nightlyMinor: number;
  currency: string;
  violations: string[];
  status: RequestStatus;
  decidedBy: Types.ObjectId | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  bookingId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
type TravelRequestRecord = TravelRequestAttrs & { _id: Types.ObjectId };
const requestSchema = new Schema<TravelRequestAttrs>(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    hotelId: { type: Schema.Types.ObjectId, required: true },
    hotelName: String,
    city: String,
    roomTypeId: { type: Schema.Types.ObjectId, required: true },
    ratePlanId: { type: Schema.Types.ObjectId, required: true },
    checkIn: String,
    checkOut: String,
    adults: Number,
    rooms: Number,
    purpose: String,
    quotedTotalMinor: Number,
    nightlyMinor: Number,
    currency: String,
    violations: { type: [String], default: [] },
    status: { type: String, required: true },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decisionNote: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    bookingId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, versionKey: false },
);
requestSchema.index({ orgId: 1, status: 1, createdAt: -1 }, { name: 'org_status' });
requestSchema.index({ employeeId: 1, createdAt: -1 }, { name: 'employee' });
requestSchema.index(
  { bookingId: 1 },
  {
    unique: true,
    partialFilterExpression: { bookingId: { $type: 'objectId' } },
    name: 'uniq_booking',
  },
);
export const TravelRequestModel = model<TravelRequestAttrs>('TravelRequest', requestSchema);

/** Pure policy evaluation (unit-tested). */
export function evaluatePolicy(
  policy: TravelPolicy,
  r: {
    nightlyMinor: number;
    totalMinor: number;
    stars: number;
    city: string;
    advanceDays: number;
    committedThisMonthMinor: number;
  },
) {
  const v: string[] = [];
  if (policy.maxNightlyMinor !== null && r.nightlyMinor > policy.maxNightlyMinor)
    v.push('NIGHTLY_RATE_ABOVE_LIMIT');
  if (policy.maxStarCategory !== null && r.stars > policy.maxStarCategory)
    v.push('STAR_CATEGORY_ABOVE_LIMIT');
  if (
    policy.allowedCities.length &&
    !policy.allowedCities.some((c) => c.toLowerCase() === r.city.toLowerCase())
  )
    v.push('CITY_NOT_ALLOWED');
  if (r.advanceDays < policy.minAdvanceDays) v.push('BOOKED_TOO_LATE');
  if (
    policy.monthlyBudgetMinor !== null &&
    r.committedThisMonthMinor + r.totalMinor > policy.monthlyBudgetMinor
  )
    v.push('OVER_MONTHLY_BUDGET');
  const needsApproval =
    v.length > 0 ||
    (policy.approvalRequiredAboveMinor !== null &&
      r.totalMinor > policy.approvalRequiredAboveMinor);
  return { violations: v, status: (needsApproval ? 'PENDING' : 'AUTO_APPROVED') as RequestStatus };
}

/**
 * Corporate travel. All data is scoped to the caller's own organisation (one per user); anything
 * outside it is "not found". Policies and budgets are evaluated on the server against a real quote.
 * Organisations start PENDING_VERIFICATION until a Stayscape admin approves them.
 */
export class CorporateService {
  constructor(
    private readonly deps: {
      quotes: QuoteService;
      documents: DocumentsService;
      notifications: NotificationService;
      audit: AuditService;
    },
  ) {}

  private async membership(userId: string, roles?: OrgRole[], requireActive = true) {
    const member = await OrgMemberModel.findOne({ userId }).lean<OrgMemberRecord>();
    if (!member) throw Errors.notFound('Organisation');
    const org = await OrganizationModel.findById(member.orgId).lean<OrganizationRecord>();
    if (!org) throw Errors.notFound('Organisation');
    if (roles && !roles.includes(member.role))
      throw Errors.forbidden('Your organisation role does not allow this.');
    if (requireActive && org.status !== 'ACTIVE')
      throw new AppError(
        409,
        'INVALID_STATE',
        org.status === 'SUSPENDED'
          ? 'This organisation is suspended.'
          : 'This organisation is awaiting verification by Stayscape.',
      );
    return { org, member };
  }

  private orgDto(org: OrganizationRecord, member?: OrgMemberRecord) {
    return {
      id: org._id.toString(),
      name: org.name,
      billingEmail: org.billingEmail,
      gstin: org.gstin,
      status: org.status,
      statusReason: org.statusReason,
      policy: { ...DEFAULT_POLICY, ...org.policy },
      myRole: member?.role ?? null,
      createdAt: org.createdAt.toISOString(),
    };
  }

  async create(
    userId: string,
    input: { name: string; billingEmail: string; gstin: string | null },
    context: RequestContext,
  ) {
    if (await OrgMemberModel.exists({ userId }))
      throw new AppError(409, 'CONFLICT', 'You already belong to an organisation.');
    const org = (
      await OrganizationModel.create({ ...input, createdBy: userId })
    ).toObject() as OrganizationRecord;
    try {
      await OrgMemberModel.create({ orgId: org._id, userId, role: 'ORG_ADMIN' });
    } catch (error) {
      await OrganizationModel.deleteOne({ _id: org._id });
      if (isMongoDuplicateKey(error))
        throw new AppError(409, 'CONFLICT', 'You already belong to an organisation.');
      throw error;
    }
    await this.deps.audit.record({
      actorId: userId,
      action: 'corporate.org_created',
      entityType: 'Organization',
      entityId: org._id.toString(),
      context,
    });
    return this.mine(userId);
  }

  async mine(userId: string) {
    const { org, member } = await this.membership(userId, undefined, false);
    return this.orgDto(org, member);
  }

  async updatePolicy(userId: string, policy: TravelPolicy, context: RequestContext) {
    const { org } = await this.membership(userId, ['ORG_ADMIN'], false);
    await OrganizationModel.updateOne({ _id: org._id }, { $set: { policy } });
    await this.deps.audit.record({
      actorId: userId,
      action: 'corporate.policy_updated',
      entityType: 'Organization',
      entityId: org._id.toString(),
      metadata: { before: org.policy, after: policy },
      context,
    });
    return this.mine(userId);
  }

  async members(userId: string) {
    const { org } = await this.membership(userId, ['ORG_ADMIN', 'APPROVER'], false);
    const rows = await OrgMemberModel.find({ orgId: org._id }).lean<OrgMemberRecord[]>();
    const users = await UserModel.find(
      { _id: { $in: rows.map((r) => r.userId) } },
      { firstName: 1, lastName: 1, email: 1 },
    ).lean<Array<{ _id: Types.ObjectId; firstName: string; lastName: string; email: string }>>();
    return rows.map((r) => {
      const u = users.find((x) => x._id.equals(r.userId));
      return {
        userId: r.userId.toString(),
        name: u ? `${u.firstName} ${u.lastName}` : '',
        email: u?.email ?? '',
        role: r.role,
        department: r.department,
      };
    });
  }

  async invite(
    userId: string,
    input: { email: string; role: OrgRole; department: string },
    context: RequestContext,
  ) {
    const { org } = await this.membership(userId, ['ORG_ADMIN']);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 14 * 86_400_000);
    await OrgInvitationModel.create({
      orgId: org._id,
      email: input.email.toLowerCase(),
      role: input.role,
      department: input.department,
      tokenHash: hash(token),
      expiresAt,
      invitedBy: userId,
    });
    await this.deps.audit.record({
      actorId: userId,
      action: 'corporate.member_invited',
      entityType: 'Organization',
      entityId: org._id.toString(),
      metadata: { role: input.role },
      context,
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async accept(userId: string, token: string) {
    const inv = await OrgInvitationModel.findOne({
      tokenHash: hash(token),
      acceptedAt: null,
      expiresAt: { $gt: new Date() },
    }).lean<OrgInvitationAttrs & { _id: Types.ObjectId }>();
    if (!inv) throw Errors.notFound('Invitation');
    const me = await UserModel.findById(userId, { email: 1 }).lean<{ email: string }>();
    if (!me || me.email.toLowerCase() !== inv.email)
      throw Errors.forbidden('This invitation was sent to a different email address.');
    try {
      await OrgMemberModel.create({
        orgId: inv.orgId,
        userId,
        role: inv.role,
        department: inv.department,
      });
    } catch (error) {
      if (isMongoDuplicateKey(error))
        throw new AppError(409, 'CONFLICT', 'You already belong to an organisation.');
      throw error;
    }
    await OrgInvitationModel.updateOne({ _id: inv._id }, { $set: { acceptedAt: new Date() } });
    return this.mine(userId);
  }

  async updateMember(
    userId: string,
    memberUserId: string,
    input: { role: OrgRole; department: string },
    context: RequestContext,
  ) {
    const { org } = await this.membership(userId, ['ORG_ADMIN'], false);
    const target = Types.ObjectId.isValid(memberUserId)
      ? await OrgMemberModel.findOne({
          orgId: org._id,
          userId: memberUserId,
        }).lean<OrgMemberRecord>()
      : null;
    if (!target) throw Errors.notFound('Member');
    if (
      target.role === 'ORG_ADMIN' &&
      input.role !== 'ORG_ADMIN' &&
      (await OrgMemberModel.countDocuments({ orgId: org._id, role: 'ORG_ADMIN' })) === 1
    )
      throw new AppError(409, 'CONFLICT', 'An organisation needs at least one administrator.');
    await OrgMemberModel.updateOne({ _id: target._id }, { $set: input });
    await this.deps.audit.record({
      actorId: userId,
      action: 'corporate.member_updated',
      entityType: 'Organization',
      entityId: org._id.toString(),
      metadata: {
        member: memberUserId,
        before: { role: target.role, department: target.department },
        after: input,
      },
      context,
    });
    return this.members(userId);
  }

  async removeMember(userId: string, memberUserId: string, context: RequestContext) {
    const { org } = await this.membership(userId, ['ORG_ADMIN'], false);
    const target = Types.ObjectId.isValid(memberUserId)
      ? await OrgMemberModel.findOne({
          orgId: org._id,
          userId: memberUserId,
        }).lean<OrgMemberRecord>()
      : null;
    if (!target) throw Errors.notFound('Member');
    if (
      target.role === 'ORG_ADMIN' &&
      (await OrgMemberModel.countDocuments({ orgId: org._id, role: 'ORG_ADMIN' })) === 1
    )
      throw new AppError(409, 'CONFLICT', 'An organisation needs at least one administrator.');
    await OrgMemberModel.deleteOne({ _id: target._id });
    await this.deps.audit.record({
      actorId: userId,
      action: 'corporate.member_removed',
      entityType: 'Organization',
      entityId: org._id.toString(),
      metadata: { member: memberUserId },
      context,
    });
  }

  // ------------------------------------------------------------------ travel requests
  private requestDto(r: TravelRequestRecord, names?: Map<string, string>) {
    return {
      id: r._id.toString(),
      employee: { id: r.employeeId.toString(), name: names?.get(r.employeeId.toString()) ?? null },
      hotel: { id: r.hotelId.toString(), name: r.hotelName, city: r.city },
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      adults: r.adults,
      rooms: r.rooms,
      purpose: r.purpose,
      quotedTotalMinor: r.quotedTotalMinor,
      nightlyMinor: r.nightlyMinor,
      currency: r.currency,
      violations: r.violations,
      status: r.status,
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      bookingId: r.bookingId?.toString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async createRequest(
    userId: string,
    input: {
      hotelId: string;
      roomTypeId: string;
      ratePlanId: string;
      checkIn: string;
      checkOut: string;
      adults: number;
      rooms: number;
      purpose: string;
    },
    context: RequestContext,
  ) {
    const { org } = await this.membership(userId);
    // The price is quoted by the real engine now; nothing from the client is trusted.
    const quote = await this.deps.quotes.quote({
      hotelId: input.hotelId,
      roomTypeId: input.roomTypeId,
      ratePlanId: input.ratePlanId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      adults: input.adults,
      children: 0,
      childrenAges: [],
      rooms: input.rooms,
      extraBeds: 0,
    });
    const hotel = (await HotelModel.findById(input.hotelId, {
      name: 1,
      city: 1,
      starCategory: 1,
      timeZone: 1,
    }).lean<HotelRecord>())!;
    const nights = diffDays(input.checkIn, input.checkOut);
    const nightly = Math.round(quote.totals.subtotalMinor / (nights * input.rooms));
    const month = input.checkIn.slice(0, 7);
    const committed = await TravelRequestModel.aggregate<{ n: number }>([
      {
        $match: {
          orgId: org._id,
          status: { $in: ['APPROVED', 'AUTO_APPROVED', 'BOOKED'] },
          checkIn: { $regex: `^${month}` },
        },
      },
      { $group: { _id: null, n: { $sum: '$quotedTotalMinor' } } },
    ]);
    const policy = { ...DEFAULT_POLICY, ...org.policy };
    const { violations, status } = evaluatePolicy(policy, {
      nightlyMinor: nightly,
      totalMinor: quote.totals.totalMinor,
      stars: hotel.starCategory,
      city: hotel.city,
      advanceDays: diffDays(todayInTimeZone(hotel.timeZone), input.checkIn),
      committedThisMonthMinor: committed[0]?.n ?? 0,
    });
    const created = (
      await TravelRequestModel.create({
        orgId: org._id,
        employeeId: userId,
        hotelId: hotel._id,
        hotelName: hotel.name,
        city: hotel.city,
        roomTypeId: input.roomTypeId,
        ratePlanId: input.ratePlanId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        adults: input.adults,
        rooms: input.rooms,
        purpose: input.purpose,
        quotedTotalMinor: quote.totals.totalMinor,
        nightlyMinor: nightly,
        currency: quote.currency,
        violations,
        status,
        ...(status === 'AUTO_APPROVED' ? { decidedAt: new Date() } : {}),
      })
    ).toObject() as TravelRequestRecord;
    if (status === 'PENDING') {
      const approvers = await OrgMemberModel.find(
        {
          orgId: org._id,
          role: { $in: ['APPROVER', 'ORG_ADMIN'] },
          userId: { $ne: new Types.ObjectId(userId) },
        },
        { userId: 1 },
      ).lean<OrgMemberRecord[]>();
      await Promise.all(
        approvers.map((a) =>
          this.deps.notifications.notifyInApp({
            userId: a.userId.toString(),
            type: 'CORPORATE_APPROVAL',
            title: 'A trip needs your approval',
            body: `${hotel.name}, ${input.checkIn} → ${input.checkOut}`,
          }),
        ),
      );
    }
    await this.deps.audit.record({
      actorId: userId,
      action: 'corporate.request_created',
      entityType: 'TravelRequest',
      entityId: created._id.toString(),
      metadata: { status, violations },
      context,
    });
    return this.requestDto(created);
  }

  async listRequests(
    userId: string,
    q: { page: number; limit: number; status?: RequestStatus | undefined; scope: 'mine' | 'org' },
  ) {
    const { org, member } = await this.membership(userId, undefined, false);
    if (q.scope === 'org' && member.role === 'EMPLOYEE')
      throw Errors.forbidden('Only approvers and administrators can see all requests.');
    const filter: Record<string, unknown> = {
      orgId: org._id,
      ...(q.scope === 'mine' ? { employeeId: new Types.ObjectId(userId) } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      TravelRequestModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean<TravelRequestRecord[]>(),
      TravelRequestModel.countDocuments(filter),
    ]);
    const users = await UserModel.find(
      { _id: { $in: rows.map((r) => r.employeeId) } },
      { firstName: 1, lastName: 1 },
    ).lean<Array<{ _id: Types.ObjectId; firstName: string; lastName: string }>>();
    const names = new Map(users.map((u) => [u._id.toString(), `${u.firstName} ${u.lastName}`]));
    return paginated(
      rows.map((r) => this.requestDto(r, names)),
      q.page,
      q.limit,
      total,
    );
  }

  async decide(
    userId: string,
    requestId: string,
    input: { decision: 'APPROVE' | 'REJECT'; note: string },
    context: RequestContext,
  ) {
    const { org } = await this.membership(userId, ['APPROVER', 'ORG_ADMIN']);
    if (!Types.ObjectId.isValid(requestId)) throw Errors.notFound('Request');
    const r = await TravelRequestModel.findOne({
      _id: requestId,
      orgId: org._id,
    }).lean<TravelRequestRecord>();
    if (!r) throw Errors.notFound('Request');
    if (r.employeeId.equals(userId)) throw Errors.forbidden('You cannot approve your own travel.');
    const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const updated = await TravelRequestModel.findOneAndUpdate(
      { _id: r._id, status: 'PENDING' },
      {
        $set: {
          status,
          decidedBy: userId,
          decisionNote: input.note || null,
          decidedAt: new Date(),
        },
      },
      { new: true },
    ).lean<TravelRequestRecord>();
    if (!updated)
      throw new AppError(409, 'INVALID_STATE', 'This request has already been decided.');
    await this.deps.notifications.notifyInApp({
      userId: r.employeeId.toString(),
      type: 'CORPORATE_APPROVAL',
      title: `Trip ${status === 'APPROVED' ? 'approved' : 'not approved'}`,
      body: `${r.hotelName}, ${r.checkIn} → ${r.checkOut}${input.note ? ` — ${input.note}` : ''}`,
    });
    await this.deps.audit.record({
      actorId: userId,
      action: `corporate.request_${status.toLowerCase()}`,
      entityType: 'TravelRequest',
      entityId: requestId,
      metadata: { before: { status: 'PENDING' }, after: { status }, note: input.note },
      context,
    });
    return this.requestDto(updated);
  }

  /** Link the employee's own confirmed booking to an approved request (matching property and dates). */
  async linkBooking(userId: string, requestId: string, reference: string, context: RequestContext) {
    const { org } = await this.membership(userId);
    const r = Types.ObjectId.isValid(requestId)
      ? await TravelRequestModel.findOne({
          _id: requestId,
          orgId: org._id,
          employeeId: userId,
        }).lean<TravelRequestRecord>()
      : null;
    if (!r) throw Errors.notFound('Request');
    if (!['APPROVED', 'AUTO_APPROVED'].includes(r.status))
      throw new AppError(
        409,
        'INVALID_STATE',
        'Only approved requests can be linked to a booking.',
      );
    const b = await BookingModel.findOne({
      bookingReference: reference,
      customerId: userId,
    }).lean<BookingRecord>();
    if (!b || !b.confirmedAt)
      throw Errors.validation({
        fieldErrors: {
          bookingReference: ['No confirmed booking with this reference on your account'],
        },
      });
    if (
      !b.hotelId.equals(r.hotelId) ||
      b.checkInLocalDate !== r.checkIn ||
      b.checkOutLocalDate !== r.checkOut
    )
      throw Errors.validation({
        fieldErrors: {
          bookingReference: ['The booking does not match the approved property and dates'],
        },
      });
    try {
      const updated = await TravelRequestModel.findOneAndUpdate(
        { _id: r._id, status: { $in: ['APPROVED', 'AUTO_APPROVED'] } },
        { $set: { status: 'BOOKED', bookingId: b._id } },
        { new: true },
      ).lean<TravelRequestRecord>();
      if (!updated)
        throw new AppError(409, 'INVALID_STATE', 'This request changed. Reload and try again.');
      await this.deps.audit.record({
        actorId: userId,
        action: 'corporate.booking_linked',
        entityType: 'TravelRequest',
        entityId: requestId,
        metadata: { booking: reference },
        context,
      });
      return this.requestDto(updated);
    } catch (error) {
      if (isMongoDuplicateKey(error))
        throw new AppError(409, 'CONFLICT', 'This booking is already linked to a request.');
      throw error;
    }
  }

  /** Spend and compliance from linked bookings' own price snapshots (no estimates). */
  async report(userId: string, from: string, to: string) {
    const { org } = await this.membership(userId, ['ORG_ADMIN', 'APPROVER'], false);
    const reqs = await TravelRequestModel.find({
      orgId: org._id,
      checkIn: { $gte: from, $lt: to },
    }).lean<TravelRequestRecord[]>();
    const bookings = await BookingModel.find(
      { _id: { $in: reqs.map((r) => r.bookingId).filter(Boolean) } },
      { priceSnapshot: 1, bookingStatus: 1, customerId: 1 },
    ).lean<BookingRecord[]>();
    const members = await OrgMemberModel.find({ orgId: org._id }).lean<OrgMemberRecord[]>();
    const dept = new Map(members.map((m) => [m.userId.toString(), m.department || 'Unassigned']));
    const live = bookings.filter((b) => !['CANCELLED', 'REJECTED'].includes(b.bookingStatus));
    const byDept = new Map<string, { spendMinor: number; bookings: number }>();
    for (const b of live) {
      const d = dept.get(b.customerId.toString()) ?? 'Former members';
      const cur = byDept.get(d) ?? { spendMinor: 0, bookings: 0 };
      byDept.set(d, {
        spendMinor: cur.spendMinor + b.priceSnapshot.totals.totalMinor,
        bookings: cur.bookings + 1,
      });
    }
    const decided = reqs.filter((r) => r.status !== 'PENDING');
    return {
      period: { from, to },
      requests: {
        total: reqs.length,
        pending: reqs.filter((r) => r.status === 'PENDING').length,
        rejected: reqs.filter((r) => r.status === 'REJECTED').length,
        booked: reqs.filter((r) => r.status === 'BOOKED').length,
      },
      spendMinor: live.reduce((s, b) => s + b.priceSnapshot.totals.totalMinor, 0),
      currency: 'INR',
      inPolicyRateBp: decided.length
        ? Math.round(
            (decided.filter((r) => r.violations.length === 0).length * 10_000) / decided.length,
          )
        : null,
      byDepartment: [...byDept.entries()]
        .map(([department, v]) => ({ department, ...v }))
        .sort((a, b) => b.spendMinor - a.spendMinor),
      budget: { monthlyBudgetMinor: org.policy?.monthlyBudgetMinor ?? null },
    };
  }

  async invoices(userId: string) {
    const { org } = await this.membership(userId, ['ORG_ADMIN'], false);
    const reqs = await TravelRequestModel.find({ orgId: org._id, status: 'BOOKED' })
      .sort({ checkIn: -1 })
      .limit(200)
      .lean<TravelRequestRecord[]>();
    const bookings = await BookingModel.find(
      { _id: { $in: reqs.map((r) => r.bookingId) } },
      { bookingReference: 1, priceSnapshot: 1, bookingStatus: 1 },
    ).lean<BookingRecord[]>();
    return reqs.map((r) => {
      const b = bookings.find((x) => x._id.equals(r.bookingId!));
      return {
        requestId: r._id.toString(),
        bookingReference: b?.bookingReference ?? null,
        hotelName: r.hotelName,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        totalMinor: b?.priceSnapshot.totals.totalMinor ?? null,
        currency: b?.priceSnapshot.currency ?? r.currency,
        status: b?.bookingStatus ?? null,
      };
    });
  }

  async invoicePdf(userId: string, reference: string) {
    const { org } = await this.membership(userId, ['ORG_ADMIN'], false);
    const b = await BookingModel.findOne(
      { bookingReference: reference },
      { customerId: 1 },
    ).lean<BookingRecord>();
    // Only bookings linked to this organisation's requests are visible to its administrators.
    if (!b || !(await TravelRequestModel.exists({ orgId: org._id, bookingId: b._id })))
      throw Errors.notFound('Booking');
    return this.deps.documents.invoicePdf(b.customerId.toString(), reference);
  }

  // ------------------------------------------------------------------ platform admin
  async adminList(page: number, limit: number, status?: string) {
    const filter = status ? { status } : {};
    const [rows, total] = await Promise.all([
      OrganizationModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<OrganizationRecord[]>(),
      OrganizationModel.countDocuments(filter),
    ]);
    return paginated(
      rows.map((o) => this.orgDto(o)),
      page,
      limit,
      total,
    );
  }

  async adminDecide(
    actorId: string,
    orgId: string,
    input: { decision: 'APPROVE' } | { decision: 'SUSPEND'; reason: string },
    context: RequestContext,
  ) {
    if (!Types.ObjectId.isValid(orgId)) throw Errors.notFound('Organisation');
    const before = await OrganizationModel.findById(orgId).lean<OrganizationRecord>();
    if (!before) throw Errors.notFound('Organisation');
    const set =
      input.decision === 'APPROVE'
        ? { status: 'ACTIVE', statusReason: null }
        : { status: 'SUSPENDED', statusReason: input.reason };
    await OrganizationModel.updateOne({ _id: before._id }, { $set: set });
    await this.deps.audit.record({
      actorId,
      action: `corporate.org_${input.decision.toLowerCase()}`,
      entityType: 'Organization',
      entityId: orgId,
      metadata: { before: { status: before.status }, after: set },
      context,
    });
    return this.orgDto({ ...before, ...(set as Partial<OrganizationRecord>) });
  }
}
