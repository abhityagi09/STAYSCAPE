import { Types } from 'mongoose';
import type { TicketCategory, TicketDto, TicketMessageDto } from '@stayscape/shared';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import { randomCode } from '@/lib/references';
import type { RequestContext } from '@/lib/request-context';
import type { AuditService } from '@/modules/audit/audit.service';
import { BookingModel, type BookingRecord } from '@/modules/bookings/booking.models';
import { MediaAssetModel, type MediaAssetRecord } from '@/modules/media/media-asset.model';
import type { MediaService, UploadedFile } from '@/modules/media/media.service';
import { UserModel } from '@/modules/users/user.model';
import type { AuthContext } from '@/types/express';
import {
  SupportTicketModel,
  TicketMessageModel,
  type SupportTicketRecord,
  type TicketMessageRecord,
} from './support.models';

/**
 * Customer support foundation (the agent console is Phase 4). Customers see and act only on their
 * own tickets; attachments are private files served through an ownership-checked endpoint.
 */
export class SupportService {
  constructor(
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  private async owned(customerId: string, id: string): Promise<SupportTicketRecord> {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Ticket');
    const ticket = await SupportTicketModel.findOne({
      _id: id,
      customerId,
    }).lean<SupportTicketRecord>();
    if (!ticket) throw Errors.notFound('Ticket');
    return ticket;
  }

  private toDto(t: SupportTicketRecord, messages?: TicketMessageDto[]): TicketDto {
    return {
      id: t._id.toString(),
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      category: t.category,
      status: t.status,
      bookingReference: t.bookingReference,
      lastMessageAt: t.lastMessageAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
      ...(messages ? { messages } : {}),
    };
  }

  private async messages(ticketId: Types.ObjectId): Promise<TicketMessageDto[]> {
    const rows = await TicketMessageModel.find({ ticketId })
      .sort({ createdAt: 1 })
      .lean<TicketMessageRecord[]>();
    const files = await MediaAssetModel.find({
      _id: { $in: rows.flatMap((m) => m.attachmentIds) },
    }).lean<MediaAssetRecord[]>();
    return rows.map((m) => ({
      id: m._id.toString(),
      author: m.authorRole,
      authorName: m.authorName,
      body: m.body,
      attachments: m.attachmentIds.flatMap((id) => {
        const f = files.find((x) => x._id.equals(id));
        return f
          ? [
              {
                id: f._id.toString(),
                fileName: f.originalFileName,
                contentType: f.contentType,
                size: f.size,
              },
            ]
          : [];
      }),
      createdAt: m.createdAt.toISOString(),
    }));
  }

  private async attach(
    auth: AuthContext,
    file: UploadedFile | undefined,
  ): Promise<Types.ObjectId[]> {
    if (!file) return [];
    const asset = await this.media.uploadPrivateFile({
      uploadedBy: auth.userId,
      purpose: 'SUPPORT_ATTACHMENT',
      file,
    });
    await MediaAssetModel.updateOne({ _id: asset._id }, { $set: { status: 'ATTACHED' } });
    return [asset._id];
  }

  async create(
    auth: AuthContext,
    input: {
      subject: string;
      category: TicketCategory;
      bookingReference: string | null;
      message: string;
    },
    file: UploadedFile | undefined,
    context: RequestContext,
  ): Promise<TicketDto> {
    let booking: BookingRecord | null = null;
    if (input.bookingReference) {
      // A ticket can only be linked to the customer's own booking.
      booking = await BookingModel.findOne({
        bookingReference: input.bookingReference,
        customerId: auth.userId,
      }).lean<BookingRecord>();
      if (!booking)
        throw Errors.validation({
          fieldErrors: { bookingReference: ['No booking with this reference on your account'] },
        });
    }
    const open = await SupportTicketModel.countDocuments({
      customerId: auth.userId,
      status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'ESCALATED'] },
    });
    if (open >= 10)
      throw new AppError(
        409,
        'CONFLICT',
        'You have many open requests. Please reply on an existing one.',
      );
    const user = await UserModel.findById(auth.userId, { firstName: 1, lastName: 1 }).lean<{
      firstName: string;
      lastName: string;
    }>();
    const attachments = await this.attach(auth, file);
    const now = new Date();
    let ticket: SupportTicketRecord | null = null;
    for (let i = 0; i < 3 && !ticket; i += 1) {
      try {
        ticket = (
          await SupportTicketModel.create({
            ticketNumber: `TKT-${randomCode(8)}`,
            customerId: auth.userId,
            bookingId: booking?._id ?? null,
            bookingReference: booking?.bookingReference ?? null,
            subject: input.subject,
            category: input.category,
            status: 'OPEN',
            statusHistory: [{ status: 'OPEN', at: now, by: new Types.ObjectId(auth.userId) }],
            lastMessageAt: now,
          })
        ).toObject() as SupportTicketRecord;
      } catch (error) {
        if (!isMongoDuplicateKey(error)) throw error;
      }
    }
    if (!ticket)
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Could not create the ticket. Please retry.');
    await TicketMessageModel.create({
      ticketId: ticket._id,
      authorId: auth.userId,
      authorRole: 'CUSTOMER',
      authorName: user ? `${user.firstName} ${user.lastName}` : 'Customer',
      body: input.message,
      attachmentIds: attachments,
    });
    await this.audit.record({
      actorId: auth.userId,
      action: 'support.ticket_created',
      entityType: 'SupportTicket',
      entityId: ticket._id.toString(),
      context,
    });
    return this.toDto(ticket, await this.messages(ticket._id));
  }

  async list(auth: AuthContext): Promise<TicketDto[]> {
    const tickets = await SupportTicketModel.find({ customerId: auth.userId })
      .sort({ lastMessageAt: -1 })
      .limit(100)
      .lean<SupportTicketRecord[]>();
    return tickets.map((t) => this.toDto(t));
  }

  async detail(auth: AuthContext, id: string): Promise<TicketDto> {
    const ticket = await this.owned(auth.userId, id);
    return this.toDto(ticket, await this.messages(ticket._id));
  }

  async reply(
    auth: AuthContext,
    id: string,
    body: string,
    file: UploadedFile | undefined,
  ): Promise<TicketDto> {
    const ticket = await this.owned(auth.userId, id);
    if (ticket.status === 'CLOSED')
      throw new AppError(
        409,
        'INVALID_STATE',
        'This ticket is closed. Open a new one if you still need help.',
      );
    const user = await UserModel.findById(auth.userId, { firstName: 1, lastName: 1 }).lean<{
      firstName: string;
      lastName: string;
    }>();
    const attachments = await this.attach(auth, file);
    await TicketMessageModel.create({
      ticketId: ticket._id,
      authorId: auth.userId,
      authorRole: 'CUSTOMER',
      authorName: user ? `${user.firstName} ${user.lastName}` : 'Customer',
      body,
      attachmentIds: attachments,
    });
    // A customer reply re-opens a resolved ticket and hands a waiting one back to the team.
    const next =
      ticket.status === 'WAITING_FOR_CUSTOMER'
        ? 'IN_PROGRESS'
        : ticket.status === 'RESOLVED'
          ? 'OPEN'
          : ticket.status;
    await SupportTicketModel.updateOne(
      { _id: ticket._id },
      {
        $set: { lastMessageAt: new Date(), status: next },
        ...(next !== ticket.status
          ? {
              $push: {
                statusHistory: {
                  status: next,
                  at: new Date(),
                  by: new Types.ObjectId(auth.userId),
                },
              },
            }
          : {}),
      },
    );
    return this.detail(auth, id);
  }

  async close(auth: AuthContext, id: string): Promise<TicketDto> {
    const ticket = await this.owned(auth.userId, id);
    if (ticket.status !== 'CLOSED') {
      await SupportTicketModel.updateOne(
        { _id: ticket._id },
        {
          $set: { status: 'CLOSED' },
          $push: {
            statusHistory: {
              status: 'CLOSED',
              at: new Date(),
              by: new Types.ObjectId(auth.userId),
            },
          },
        },
      );
    }
    return this.detail(auth, id);
  }

  async attachment(
    auth: AuthContext,
    ticketId: string,
    mediaId: string,
  ): Promise<{ body: Buffer; asset: MediaAssetRecord }> {
    const ticket = await this.owned(auth.userId, ticketId);
    if (
      !Types.ObjectId.isValid(mediaId) ||
      !(await TicketMessageModel.exists({
        ticketId: ticket._id,
        attachmentIds: new Types.ObjectId(mediaId),
      }))
    )
      throw Errors.notFound('File');
    return this.media.readPrivateFile(mediaId, 'SUPPORT_ATTACHMENT');
  }

  async openCount(customerId: string): Promise<number> {
    return SupportTicketModel.countDocuments({
      customerId,
      status: { $nin: ['RESOLVED', 'CLOSED'] },
    });
  }
}
