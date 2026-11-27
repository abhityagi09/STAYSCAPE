import { Types, type PipelineStage } from 'mongoose';
import {
  TICKET_PRIORITIES,
  hasPermission,
  type AgentTicketDto,
  type AgentTicketMessageDto,
  type PartnerTicketDto,
  type Role,
  type TicketChannel,
  type TicketPriority,
  type TicketStatus,
} from '@stayscape/shared';
import { AppError, Errors } from '@/lib/errors';
import { paginated } from '@/lib/http';
import type { RequestContext } from '@/lib/request-context';
import type { AuditService } from '@/modules/audit/audit.service';
import { HotelModel } from '@/modules/hotels/hotel.model';
import { MediaAssetModel, type MediaAssetRecord } from '@/modules/media/media-asset.model';
import type { MediaService, UploadedFile } from '@/modules/media/media.service';
import type { PartnerAccessService } from '@/modules/partners/partner-access.service';
import { UserModel } from '@/modules/users/user.model';
import type { AuthContext } from '@/types/express';
import { SupportTicketModel, TicketMessageModel, type SupportTicketRecord, type TicketMessageRecord } from './support.models';

const ACTIVE: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'ESCALATED'];
/** Phase 3 rows carry no channel; they are customer-thread messages. */
const channelFilter = (channels: TicketChannel[]) => ({
  $or: [{ channel: { $in: channels } }, ...(channels.includes('CUSTOMER') ? [{ channel: { $exists: false } }] : [])],
});
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface QueueQuery {
  page: number;
  limit: number;
  status: TicketStatus | 'ACTIVE';
  priority?: TicketPriority | undefined;
  assignee?: string | undefined;
  category?: string | undefined;
  q?: string | undefined;
  sort: 'priority' | 'oldest' | 'newest' | 'last_message';
}

/**
 * Support agent console (requires `support:manage`, enforced at the router) and the property-side
 * view of tickets an agent has shared. Every state change is audited with before/after values.
 */
export class SupportConsoleService {
  constructor(private readonly deps: { media: MediaService; audit: AuditService; access: PartnerAccessService }) {}

  private async ticket(id: string): Promise<SupportTicketRecord> {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Ticket');
    const t = await SupportTicketModel.findById(id).lean<SupportTicketRecord>();
    if (!t) throw Errors.notFound('Ticket');
    return t;
  }

  private async names(ids: Array<Types.ObjectId | null | undefined>) {
    const users = await UserModel.find({ _id: { $in: ids.filter(Boolean) } }, { firstName: 1, lastName: 1, email: 1 }).lean<Array<{ _id: Types.ObjectId; firstName: string; lastName: string; email: string }>>();
    return new Map(users.map((u) => [u._id.toString(), { name: `${u.firstName} ${u.lastName}`, email: u.email }]));
  }

  private async messages(ticketId: Types.ObjectId, channels: TicketChannel[]): Promise<AgentTicketMessageDto[]> {
    const rows = await TicketMessageModel.find({ ticketId, ...channelFilter(channels) })
      .sort({ createdAt: 1 })
      .lean<TicketMessageRecord[]>();
    const files = await MediaAssetModel.find({ _id: { $in: rows.flatMap((m) => m.attachmentIds) } }).lean<MediaAssetRecord[]>();
    return rows.map((m) => ({
      id: m._id.toString(),
      channel: m.channel ?? 'CUSTOMER',
      author: m.authorRole,
      authorName: m.authorName,
      body: m.body,
      attachments: m.attachmentIds.flatMap((id) => {
        const f = files.find((x) => x._id.equals(id));
        return f ? [{ id: f._id.toString(), fileName: f.originalFileName, contentType: f.contentType, size: f.size }] : [];
      }),
      createdAt: m.createdAt.toISOString(),
    }));
  }

  private async toDtos(tickets: SupportTicketRecord[]): Promise<AgentTicketDto[]> {
    const people = await this.names(tickets.flatMap((t) => [t.customerId, t.assigneeId]));
    const hotels = await HotelModel.find({ _id: { $in: tickets.map((t) => t.hotelId).filter(Boolean) } }, { name: 1 }).lean<Array<{ _id: Types.ObjectId; name: string }>>();
    return tickets.map((t) => {
      const customer = people.get(t.customerId.toString());
      const assignee = t.assigneeId ? people.get(t.assigneeId.toString()) : undefined;
      const hotel = t.hotelId ? hotels.find((h) => h._id.equals(t.hotelId!)) : undefined;
      return {
        id: t._id.toString(),
        ticketNumber: t.ticketNumber,
        subject: t.subject,
        category: t.category,
        status: t.status,
        bookingReference: t.bookingReference,
        lastMessageAt: t.lastMessageAt.toISOString(),
        createdAt: t.createdAt.toISOString(),
        priority: t.priority ?? 'NORMAL',
        assignee: t.assigneeId && assignee ? { id: t.assigneeId.toString(), name: assignee.name } : null,
        customer: { id: t.customerId.toString(), name: customer?.name ?? 'Customer', email: customer?.email ?? '' },
        hotel: hotel ? { id: hotel._id.toString(), name: hotel.name } : null,
        partnerVisible: t.partnerVisible ?? false,
        escalated: t.escalated ?? false,
        escalationReason: t.escalationReason ?? null,
        firstResponseAt: t.firstResponseAt?.toISOString() ?? null,
        resolvedAt: t.resolvedAt?.toISOString() ?? null,
        resolution: t.resolution ?? null,
        statusHistory: (t.statusHistory ?? []).map((h) => ({ status: h.status, at: new Date(h.at).toISOString(), by: h.by ? h.by.toString() : null })),
      };
    });
  }

  async queue(auth: AuthContext, q: QueueQuery) {
    const match: Record<string, unknown> = { status: q.status === 'ACTIVE' ? { $in: ACTIVE } : q.status };
    if (q.priority) match.priority = q.priority;
    if (q.category) match.category = q.category;
    if (q.assignee === 'me') match.assigneeId = new Types.ObjectId(auth.userId);
    else if (q.assignee === 'unassigned') match.assigneeId = null;
    else if (q.assignee) match.assigneeId = new Types.ObjectId(q.assignee);
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      match.$or = [{ ticketNumber: rx }, { subject: rx }, { bookingReference: rx }];
    }
    const sort: Record<string, 1 | -1> =
      q.sort === 'priority' ? { rank: -1, escalated: -1, lastMessageAt: 1 } : q.sort === 'oldest' ? { createdAt: 1 } : q.sort === 'newest' ? { createdAt: -1 } : { lastMessageAt: -1 };
    const pipeline: PipelineStage[] = [
      { $match: match },
      { $addFields: { rank: { $indexOfArray: [[...TICKET_PRIORITIES], { $ifNull: ['$priority', 'NORMAL'] }] } } },
      { $sort: { ...sort, _id: 1 } },
      { $facet: { items: [{ $skip: (q.page - 1) * q.limit }, { $limit: q.limit }, { $project: { rank: 0 } }], total: [{ $count: 'n' }] } },
    ];
    const [res] = await SupportTicketModel.aggregate<{ items: SupportTicketRecord[]; total: Array<{ n: number }> }>(pipeline);
    return paginated(await this.toDtos(res?.items ?? []), q.page, q.limit, res?.total[0]?.n ?? 0);
  }

  async detail(id: string): Promise<AgentTicketDto> {
    const t = await this.ticket(id);
    const [dto] = await this.toDtos([t]);
    return { ...dto!, messages: await this.messages(t._id, ['CUSTOMER', 'PARTNER', 'INTERNAL']) };
  }

  private async change(actorId: string, t: SupportTicketRecord, action: string, set: Record<string, unknown>, status: TicketStatus | null, context: RequestContext) {
    const before = Object.fromEntries(Object.keys(set).map((k) => [k, (t as unknown as Record<string, unknown>)[k] ?? null]));
    const nextStatus = status && status !== t.status ? status : null;
    await SupportTicketModel.updateOne(
      { _id: t._id },
      {
        $set: { ...set, ...(nextStatus ? { status: nextStatus } : {}) },
        ...(nextStatus ? { $push: { statusHistory: { status: nextStatus, at: new Date(), by: new Types.ObjectId(actorId) } } } : {}),
      },
    );
    await this.deps.audit.record({
      actorId,
      action,
      entityType: 'SupportTicket',
      entityId: t._id.toString(),
      metadata: { before: { ...before, ...(nextStatus ? { status: t.status } : {}) }, after: { ...set, ...(nextStatus ? { status: nextStatus } : {}) } },
      partnerId: t.partnerId?.toString() ?? null,
      hotelId: t.hotelId?.toString() ?? null,
      context,
    });
  }

  async assign(auth: AuthContext, id: string, assigneeId: string | null, context: RequestContext) {
    const t = await this.ticket(id);
    if (assigneeId) {
      const agent = await UserModel.findOne({ _id: assigneeId, accountStatus: 'ACTIVE' }, { roles: 1 }).lean<{ roles: Role[] }>();
      // Least privilege: tickets can only be assigned to people who may work the support queue.
      if (!agent || !hasPermission(agent.roles, 'support:manage')) throw Errors.validation({ fieldErrors: { assigneeId: ['This person cannot work support tickets'] } });
    }
    await this.change(auth.userId, t, 'support.ticket_assigned', { assigneeId: assigneeId ? new Types.ObjectId(assigneeId) : null }, assigneeId && t.status === 'OPEN' ? 'IN_PROGRESS' : null, context);
    return this.detail(id);
  }

  async update(auth: AuthContext, id: string, input: { priority?: TicketPriority | undefined; status?: TicketStatus | undefined; partnerVisible?: boolean | undefined }, context: RequestContext) {
    const t = await this.ticket(id);
    if (t.status === 'CLOSED') throw new AppError(409, 'INVALID_STATE', 'This ticket is closed.');
    if (input.partnerVisible && !t.hotelId) throw Errors.validation({ fieldErrors: { partnerVisible: ['This ticket is not linked to a property booking'] } });
    const set: Record<string, unknown> = {};
    if (input.priority) set.priority = input.priority;
    if (input.partnerVisible !== undefined) set.partnerVisible = input.partnerVisible;
    if (input.status && t.status === 'RESOLVED') set.resolvedAt = null;
    await this.change(auth.userId, t, 'support.ticket_updated', set, input.status ?? null, context);
    return this.detail(id);
  }

  async escalate(auth: AuthContext, id: string, reason: string, context: RequestContext) {
    const t = await this.ticket(id);
    if (['RESOLVED', 'CLOSED'].includes(t.status)) throw new AppError(409, 'INVALID_STATE', 'Re-open the ticket before escalating it.');
    await this.change(auth.userId, t, 'support.ticket_escalated', { escalated: true, escalationReason: reason, escalatedAt: new Date(), priority: t.priority === 'URGENT' ? 'URGENT' : 'HIGH' }, 'ESCALATED', context);
    return this.detail(id);
  }

  async resolve(auth: AuthContext, id: string, resolution: string, context: RequestContext) {
    const t = await this.ticket(id);
    if (['RESOLVED', 'CLOSED'].includes(t.status)) throw new AppError(409, 'INVALID_STATE', 'This ticket is already resolved.');
    await this.change(auth.userId, t, 'support.ticket_resolved', { resolvedAt: new Date(), resolution }, 'RESOLVED', context);
    return this.detail(id);
  }

  private async author(userId: string) {
    const u = await UserModel.findById(userId, { firstName: 1, lastName: 1 }).lean<{ firstName: string; lastName: string }>();
    return u ? `${u.firstName} ${u.lastName}` : 'Stayscape';
  }

  private async attach(userId: string, file: UploadedFile | undefined) {
    if (!file) return [];
    const asset = await this.deps.media.uploadPrivateFile({ uploadedBy: userId, purpose: 'SUPPORT_ATTACHMENT', file });
    await MediaAssetModel.updateOne({ _id: asset._id }, { $set: { status: 'ATTACHED' } });
    return [asset._id];
  }

  async message(auth: AuthContext, id: string, input: { channel: TicketChannel; body: string }, file: UploadedFile | undefined, context: RequestContext) {
    const t = await this.ticket(id);
    if (t.status === 'CLOSED') throw new AppError(409, 'INVALID_STATE', 'This ticket is closed.');
    if (input.channel === 'PARTNER' && (!t.hotelId || !t.partnerVisible)) throw new AppError(409, 'INVALID_STATE', 'Share the ticket with the property before messaging it.');
    const now = new Date();
    await TicketMessageModel.create({ ticketId: t._id, authorId: auth.userId, authorRole: 'AGENT', channel: input.channel, authorName: await this.author(auth.userId), body: input.body, attachmentIds: await this.attach(auth.userId, file), createdAt: now });
    if (input.channel === 'CUSTOMER') {
      // First response is set once, atomically; a reply to the customer waits on them next.
      await SupportTicketModel.updateOne({ _id: t._id, firstResponseAt: null }, { $set: { firstResponseAt: now } });
      await this.change(auth.userId, t, 'support.agent_replied', { lastMessageAt: now }, ['OPEN', 'IN_PROGRESS'].includes(t.status) ? 'WAITING_FOR_CUSTOMER' : null, context);
    } else {
      await this.deps.audit.record({ actorId: auth.userId, action: input.channel === 'INTERNAL' ? 'support.internal_note' : 'support.partner_message', entityType: 'SupportTicket', entityId: t._id.toString(), partnerId: t.partnerId?.toString() ?? null, hotelId: t.hotelId?.toString() ?? null, context });
    }
    return this.detail(id);
  }

  async attachment(ticketId: string, mediaId: string, channels: TicketChannel[] = ['CUSTOMER', 'PARTNER', 'INTERNAL']) {
    const t = await this.ticket(ticketId);
    if (!Types.ObjectId.isValid(mediaId) || !(await TicketMessageModel.exists({ ticketId: t._id, attachmentIds: new Types.ObjectId(mediaId), ...channelFilter(channels) }))) throw Errors.notFound('File');
    return this.deps.media.readPrivateFile(mediaId, 'SUPPORT_ATTACHMENT');
  }

  /** Response-time and volume metrics for a period (createdAt in [from, to)). */
  async metrics(from: Date, to: Date) {
    const [row] = await SupportTicketModel.aggregate<{ created: number; resolved: number; escalated: number; responded: number; firstResponse: number | null; resolution: number | null; open: number }>([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: null,
          created: { $sum: 1 },
          resolved: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$resolvedAt', null] }, null] }, 1, 0] } },
          escalated: { $sum: { $cond: ['$escalated', 1, 0] } },
          responded: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$firstResponseAt', null] }, null] }, 1, 0] } },
          open: { $sum: { $cond: [{ $in: ['$status', ACTIVE] }, 1, 0] } },
          firstResponse: { $avg: { $cond: [{ $ne: [{ $ifNull: ['$firstResponseAt', null] }, null] }, { $subtract: ['$firstResponseAt', '$createdAt'] }, null] } },
          resolution: { $avg: { $cond: [{ $ne: [{ $ifNull: ['$resolvedAt', null] }, null] }, { $subtract: ['$resolvedAt', '$createdAt'] }, null] } },
        },
      },
    ]);
    const byAgent = await SupportTicketModel.aggregate<{ _id: Types.ObjectId; assigned: number; resolved: number }>([
      { $match: { createdAt: { $gte: from, $lt: to }, assigneeId: { $ne: null } } },
      { $group: { _id: '$assigneeId', assigned: { $sum: 1 }, resolved: { $sum: { $cond: [{ $in: ['$status', ['RESOLVED', 'CLOSED']] }, 1, 0] } } } },
      { $sort: { assigned: -1 } },
      { $limit: 50 },
    ]);
    const people = await this.names(byAgent.map((a) => a._id));
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      created: row?.created ?? 0,
      open: row?.open ?? 0,
      resolved: row?.resolved ?? 0,
      escalated: row?.escalated ?? 0,
      responded: row?.responded ?? 0,
      averageFirstResponseMinutes: row?.firstResponse !== null && row?.firstResponse !== undefined ? Math.round(row.firstResponse / 60_000) : null,
      averageResolutionHours: row?.resolution !== null && row?.resolution !== undefined ? Math.round((row.resolution / 3_600_000) * 10) / 10 : null,
      byAgent: byAgent.map((a) => ({ agentId: a._id.toString(), name: people.get(a._id.toString())?.name ?? 'Unknown', assigned: a.assigned, resolved: a.resolved })),
    };
  }

  // ------------------------------------------------------------------ property side
  private async partnerTicket(auth: AuthContext, id: string) {
    const hotels = await this.deps.access.hotelIdsWithPermission(auth, 'bookings:view');
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Ticket');
    const t = await SupportTicketModel.findOne({ _id: id, hotelId: { $in: hotels }, partnerVisible: true }).lean<SupportTicketRecord>();
    if (!t) throw Errors.notFound('Ticket');
    return t;
  }

  private async partnerDtos(tickets: SupportTicketRecord[]): Promise<PartnerTicketDto[]> {
    const hotels = await HotelModel.find({ _id: { $in: tickets.map((t) => t.hotelId) } }, { name: 1 }).lean<Array<{ _id: Types.ObjectId; name: string }>>();
    return tickets.map((t) => ({
      id: t._id.toString(),
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      category: t.category,
      status: t.status,
      bookingReference: t.bookingReference,
      hotel: { id: t.hotelId!.toString(), name: hotels.find((h) => h._id.equals(t.hotelId!))?.name ?? '' },
      lastMessageAt: t.lastMessageAt.toISOString(),
    }));
  }

  async partnerList(auth: AuthContext) {
    const hotels = await this.deps.access.hotelIdsWithPermission(auth, 'bookings:view');
    const tickets = await SupportTicketModel.find({ hotelId: { $in: hotels }, partnerVisible: true }).sort({ lastMessageAt: -1 }).limit(100).lean<SupportTicketRecord[]>();
    return this.partnerDtos(tickets);
  }

  async partnerDetail(auth: AuthContext, id: string): Promise<PartnerTicketDto> {
    const t = await this.partnerTicket(auth, id);
    const [dto] = await this.partnerDtos([t]);
    // The property sees only its own thread with the support team.
    const messages = (await this.messages(t._id, ['PARTNER'])).map(({ channel: _channel, ...m }) => m);
    return { ...dto!, messages };
  }

  async partnerReply(auth: AuthContext, id: string, body: string, file: UploadedFile | undefined, context: RequestContext) {
    const t = await this.partnerTicket(auth, id);
    if (t.status === 'CLOSED') throw new AppError(409, 'INVALID_STATE', 'This ticket is closed.');
    await TicketMessageModel.create({ ticketId: t._id, authorId: auth.userId, authorRole: 'PARTNER', channel: 'PARTNER', authorName: await this.author(auth.userId), body, attachmentIds: await this.attach(auth.userId, file) });
    await SupportTicketModel.updateOne({ _id: t._id }, { $set: { lastMessageAt: new Date() } });
    await this.deps.audit.record({ actorId: auth.userId, action: 'support.partner_replied', entityType: 'SupportTicket', entityId: t._id.toString(), partnerId: t.partnerId?.toString() ?? null, hotelId: t.hotelId?.toString() ?? null, context });
    return this.partnerDetail(auth, id);
  }

  async partnerAttachment(auth: AuthContext, ticketId: string, mediaId: string) {
    await this.partnerTicket(auth, ticketId);
    return this.attachment(ticketId, mediaId, ['PARTNER']);
  }
}
