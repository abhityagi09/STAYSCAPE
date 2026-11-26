import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type { Logger } from 'pino';
import { AppError, Errors } from '@/lib/errors';
import type { PasswordHasher } from '@/lib/password';
import type { RequestContext } from '@/lib/request-context';
import { withTransaction } from '@/lib/transaction';
import type { StorageProvider } from '@/infrastructure/storage/storage.provider';
import type { AuditService } from '@/modules/audit/audit.service';
import { VerificationTokenModel } from '@/modules/auth/verification-token.model';
import { BookingModel } from '@/modules/bookings/booking.models';
import { OrgMemberModel } from '@/modules/corporate/corporate.service';
import { PriceAlertModel } from '@/modules/intelligence/intelligence.service';
import { NewsletterSubscriptionModel } from '@/modules/newsletter/newsletter-subscription.model';
import { NotificationModel } from '@/modules/notifications/notification.model';
import { PartnerModel, PartnerStaffModel } from '@/modules/partners/partner.model';
import { RefundModel } from '@/modules/payments/payment.models';
import { ReviewModel } from '@/modules/reviews/review.models';
import {
  LoyaltyAccountModel,
  LoyaltyEntryModel,
  ReferralCodeModel,
} from '@/modules/rewards/rewards.service';
import type { SessionService } from '@/modules/sessions/session.service';
import { RefreshSessionModel } from '@/modules/sessions/refresh-session.model';
import { SupportTicketModel, TicketMessageModel } from '@/modules/support/support.models';
import { TripModel } from '@/modules/trips/trips.service';
import { UserModel, type UserRecord } from '@/modules/users/user.model';
import { WishlistModel } from '@/modules/wishlists/wishlist.model';

/** Booking states that still create obligations between the guest and a property. */
const ACTIVE_BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_PROCESSING',
  'CONFIRMED',
  'CHECKED_IN',
  'RECONCILIATION_REQUIRED',
];
const OPEN_REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING'];

/** Exported files carry a format version so later readers know how to interpret them. */
export const EXPORT_FORMAT_VERSION = 1;

/**
 * Data-subject rights for customer accounts: a machine-readable export of the personal data
 * STAYSCAPE holds, and self-service deletion.
 *
 * Deletion anonymises the account rather than dropping records that other people or the law
 * rely on: bookings, payments, refunds and invoices are retained (tax and accounting record
 * keeping), verified reviews stay but are attributed to "Former guest". Everything that only
 * serves the person (saved lists, alerts, notifications, sessions, newsletter, referral code)
 * is removed. See docs/security.md ("Privacy") for the retention table.
 */
export class PrivacyService {
  constructor(
    private readonly deps: {
      audit: AuditService;
      hasher: PasswordHasher;
      sessions: SessionService;
      storage: StorageProvider;
      logger: Logger;
    },
  ) {}

  async exportData(userId: string, context: RequestContext) {
    const uid = new Types.ObjectId(userId);
    const user = await UserModel.findById(uid).lean<UserRecord>();
    if (!user) throw Errors.notFound('Account not found.');
    const [
      bookings,
      reviews,
      wishlists,
      alerts,
      notifications,
      tickets,
      messages,
      trips,
      sessions,
      loyalty,
      loyaltyEntries,
      newsletter,
    ] = await Promise.all([
      BookingModel.find(
        { customerId: uid },
        {
          bookingReference: 1,
          hotelSnapshot: 1,
          checkInLocalDate: 1,
          checkOutLocalDate: 1,
          numberOfNights: 1,
          totalGuests: 1,
          guestDetails: 1,
          bookingStatus: 1,
          paymentStatus: 1,
          'priceSnapshot.currency': 1,
          'priceSnapshot.totals': 1,
          createdAt: 1,
        },
      ).lean(),
      ReviewModel.find(
        { customerId: uid },
        { hotelId: 1, bookingId: 1, ratings: 1, title: 1, body: 1, status: 1, createdAt: 1 },
      ).lean(),
      WishlistModel.find({ userId: uid }, { name: 1, items: 1, createdAt: 1 }).lean(),
      PriceAlertModel.find({ userId: uid }, { userId: 0 }).lean(),
      NotificationModel.find({ userId: uid }, { userId: 0 })
        .sort({ createdAt: -1 })
        .limit(500)
        .lean(),
      SupportTicketModel.find(
        { customerId: uid },
        { ticketNumber: 1, subject: 1, category: 1, status: 1, bookingId: 1, createdAt: 1 },
      ).lean(),
      // Only the person's own messages and staff replies addressed to them; internal notes are
      // staff working notes and not part of the customer's conversation.
      TicketMessageModel.find({ authorId: uid }, { ticketId: 1, body: 1, createdAt: 1 }).lean(),
      TripModel.find(
        { $or: [{ ownerId: uid }, { 'collaborators.userId': uid }] },
        { name: 1, items: 1, notes: 1, createdAt: 1 },
      ).lean(),
      RefreshSessionModel.find(
        { userId: uid },
        { deviceInformation: 1, ipAddress: 1, createdAt: 1, revokedAt: 1, expiresAt: 1 },
      )
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
      LoyaltyAccountModel.findOne({ userId: uid }, { _id: 0, userId: 0 }).lean(),
      LoyaltyEntryModel.find({ userId: uid }, { _id: 0, userId: 0 }).sort({ createdAt: -1 }).lean(),
      NewsletterSubscriptionModel.findOne({ email: user.email }, { _id: 0 }).lean(),
    ]);
    await this.deps.audit.record({
      actorId: userId,
      action: 'user.data_exported',
      entityType: 'user',
      entityId: userId,
      context,
    });
    return {
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      notice:
        'Personal data STAYSCAPE holds about this account. Payment card details are never stored by STAYSCAPE; they stay with the payment provider.',
      account: {
        id: userId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        roles: user.roles,
        accountStatus: user.accountStatus,
        emailVerifiedAt: user.emailVerifiedAt,
        preferences: user.preferences,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      },
      bookings,
      reviews,
      wishlists,
      priceAlerts: alerts,
      notifications,
      supportTickets: tickets,
      supportMessages: messages,
      trips,
      sessions,
      loyalty: loyalty ? { account: loyalty, entries: loyaltyEntries } : null,
      newsletter,
    };
  }

  /** Returns the reasons the account cannot be deleted yet (empty when deletion may proceed). */
  async deletionBlockers(userId: string): Promise<string[]> {
    const uid = new Types.ObjectId(userId);
    const user = await UserModel.findById(uid, { roles: 1 }).lean<Pick<UserRecord, 'roles'>>();
    if (!user) throw Errors.notFound('Account not found.');
    const blockers: string[] = [];
    if (user.roles.some((r) => r !== 'CUSTOMER'))
      blockers.push(
        'Accounts with partner, staff or administrator roles are closed through support so that properties and permissions can be handed over.',
      );
    const [partner, activeBookings, bookingIds, orgAdmin] = await Promise.all([
      PartnerModel.exists({ ownerId: uid }),
      BookingModel.countDocuments({
        customerId: uid,
        bookingStatus: { $in: ACTIVE_BOOKING_STATUSES },
      }),
      BookingModel.find({ customerId: uid }, { _id: 1 }).lean<Array<{ _id: Types.ObjectId }>>(),
      OrgMemberModel.exists({ userId: uid, role: 'ORG_ADMIN' }),
    ]);
    if (partner)
      blockers.push('This account owns a partner business. Contact support to close it.');
    if (activeBookings)
      blockers.push(
        `You have ${activeBookings} upcoming or in-progress booking(s). Cancel them or wait until the stay is complete.`,
      );
    if (bookingIds.length) {
      const openRefunds = await RefundModel.countDocuments({
        bookingId: { $in: bookingIds.map((b) => b._id) },
        status: { $in: OPEN_REFUND_STATUSES },
      });
      if (openRefunds)
        blockers.push(
          'A refund is still in progress. You can delete the account once it completes.',
        );
    }
    if (orgAdmin)
      blockers.push(
        'You administer a corporate organisation. Hand over the administrator role first.',
      );
    return blockers;
  }

  async deleteAccount(userId: string, password: string, context: RequestContext) {
    const uid = new Types.ObjectId(userId);
    const user = await UserModel.findById(uid).select('+passwordHash').lean<UserRecord>();
    if (!user) throw Errors.notFound('Account not found.');
    if (!(await this.deps.hasher.verify(user.passwordHash, password)))
      throw new AppError(401, 'INVALID_CREDENTIALS', 'The password is incorrect.');
    const blockers = await this.deletionBlockers(userId);
    if (blockers.length)
      throw new AppError(409, 'NOT_ELIGIBLE', 'This account cannot be deleted yet.', {
        formErrors: blockers,
      });

    const unusableHash = await this.deps.hasher.hash(randomBytes(32).toString('base64url'));
    await withTransaction(async (session) => {
      await UserModel.updateOne(
        { _id: uid },
        {
          $set: {
            firstName: 'Deleted',
            lastName: 'user',
            email: `deleted+${userId}@deleted.stayscape.invalid`,
            phone: null,
            avatar: null,
            passwordHash: unusableHash,
            accountStatus: 'DEACTIVATED',
            emailVerifiedAt: null,
            phoneVerifiedAt: null,
            deletedAt: new Date(),
            'preferences.notifications.emailPromotions': false,
            'preferences.notifications.smsBookingUpdates': false,
            'preferences.notifications.pushEnabled': false,
            'preferences.personalization': { recommendations: false, consentedAt: null },
          },
        },
        { session },
      );
      await Promise.all([
        WishlistModel.deleteMany({ userId: uid }, { session }),
        PriceAlertModel.deleteMany({ userId: uid }, { session }),
        NotificationModel.deleteMany({ userId: uid }, { session }),
        VerificationTokenModel.deleteMany({ userId: uid }, { session }),
        ReferralCodeModel.deleteMany({ userId: uid }, { session }),
        NewsletterSubscriptionModel.deleteMany({ email: user.email }, { session }),
        OrgMemberModel.deleteMany({ userId: uid }, { session }),
        PartnerStaffModel.deleteMany({ userId: uid }, { session }),
        TripModel.deleteMany({ ownerId: uid }, { session }),
        TripModel.updateMany(
          { 'collaborators.userId': uid },
          { $pull: { collaborators: { userId: uid } } },
          { session },
        ),
        ReviewModel.updateMany(
          { customerId: uid },
          { $set: { authorName: 'Former guest' } },
          { session },
        ),
        TicketMessageModel.updateMany(
          { authorId: uid },
          { $set: { authorName: 'Former customer' } },
          { session },
        ),
      ]);
    });
    await this.deps.sessions.revokeAll(userId, 'ACCOUNT_DELETED');
    if (user.avatar?.key)
      await this.deps.storage
        .delete(user.avatar.key)
        .catch((error: unknown) =>
          this.deps.logger.warn(
            { err: error, userId },
            'avatar delete failed after account deletion',
          ),
        );
    await this.deps.audit.record({
      actorId: userId,
      action: 'user.account_deleted',
      entityType: 'user',
      entityId: userId,
      metadata: {
        retained: ['bookings', 'payments', 'refunds', 'invoices', 'reviews (anonymised)'],
      },
      context,
    });
  }
}
