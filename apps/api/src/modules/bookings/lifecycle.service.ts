import { addDays, todayInTimeZone, type CustomerOverviewDto } from '@stayscape/shared';
import type { Logger } from '@/lib/logger';
import { NotificationModel } from '@/modules/notifications/notification.model';
import type { OutboxService } from '@/modules/outbox/outbox.service';
import type { ReviewsService } from '@/modules/reviews/reviews.service';
import type { SupportService } from '@/modules/support/support.service';
import type { WishlistsService } from '@/modules/wishlists/wishlists.service';
import type { AuthContext } from '@/types/express';
import { BookingModel, type BookingRecord } from './booking.models';
import { statusEvent, type BookingsService } from './bookings.service';

/** Latest calendar date anywhere on Earth (UTC+14) — a safe upper bound for per-property "today". */
const latestToday = (now: Date) => todayInTimeZone('Pacific/Kiritimati', now);

/**
 * Stay lifecycle jobs and the customer dashboard.
 *  - completeStays: a stay whose check-out date has passed (property-local) becomes COMPLETED
 *    (CHECKED_OUT immediately on its check-out date; CONFIRMED/CHECKED_IN the day after, as the
 *    property did not record a no-show). Completion schedules one review reminder.
 *  - remindCheckins: one reminder the day before arrival (unique event id → never repeated).
 */
export class LifecycleService {
  constructor(
    private readonly deps: {
      bookings: BookingsService;
      outbox: OutboxService;
      reviews: ReviewsService;
      wishlists: WishlistsService;
      support: SupportService;
      logger: Logger;
    },
  ) {}

  async completeStays(now = new Date()): Promise<number> {
    const candidates = await BookingModel.find({
      bookingStatus: { $in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] },
      checkOutLocalDate: { $lte: latestToday(now) },
    })
      .limit(500)
      .lean<BookingRecord[]>();
    let completed = 0;
    for (const b of candidates) {
      const today = todayInTimeZone(b.propertyTimezone, now);
      const due =
        b.bookingStatus === 'CHECKED_OUT'
          ? b.checkOutLocalDate <= today
          : b.checkOutLocalDate < today;
      if (!due) continue;
      const updated = await BookingModel.findOneAndUpdate(
        { _id: b._id, bookingStatus: b.bookingStatus },
        {
          $set: { bookingStatus: 'COMPLETED', completedAt: now },
          $push: { statusHistory: statusEvent('COMPLETED', 'Stay completed') },
        },
        { new: true },
      ).lean<BookingRecord>();
      if (!updated) continue;
      await this.deps.outbox.add(
        {
          eventId: `review.reminder.${b._id}`,
          type: 'review.reminder',
          aggregateType: 'Booking',
          aggregateId: b._id.toString(),
          payload: {},
        },
        null,
      );
      completed += 1;
    }
    if (completed) await this.deps.outbox.kick();
    return completed;
  }

  async remindCheckins(now = new Date()): Promise<number> {
    const earliest = todayInTimeZone('Etc/GMT+12', now);
    const candidates = await BookingModel.find({
      bookingStatus: 'CONFIRMED',
      checkInLocalDate: { $gte: addDays(earliest, 1), $lte: addDays(latestToday(now), 1) },
    })
      .limit(1000)
      .lean<BookingRecord[]>();
    let queued = 0;
    for (const b of candidates) {
      if (b.checkInLocalDate !== addDays(todayInTimeZone(b.propertyTimezone, now), 1)) continue;
      await this.deps.outbox.add(
        {
          eventId: `checkin.reminder.${b._id}`,
          type: 'checkin.reminder',
          aggregateType: 'Booking',
          aggregateId: b._id.toString(),
          payload: {},
        },
        null,
      );
      queued += 1;
    }
    if (queued) await this.deps.outbox.kick();
    return queued;
  }

  /** Dashboard figures come only from the signed-in customer's own records. */
  async overview(auth: AuthContext): Promise<CustomerOverviewDto> {
    const customerId = auth.userId;
    const today = todayInTimeZone('UTC');
    const upcomingFilter = {
      customerId,
      bookingStatus: { $in: ['CONFIRMED', 'CHECKED_IN'] },
      checkOutLocalDate: { $gte: today },
    };
    const pendingFilter = {
      customerId,
      bookingStatus: { $in: ['PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'RECONCILIATION_REQUIRED'] },
    };
    const [
      upcomingCount,
      completed,
      pendingCount,
      cancelled,
      eligible,
      saved,
      openTickets,
      upcoming,
      pending,
      activity,
    ] = await Promise.all([
      BookingModel.countDocuments(upcomingFilter),
      BookingModel.countDocuments({
        customerId,
        bookingStatus: { $in: ['COMPLETED', 'CHECKED_OUT'] },
      }),
      BookingModel.countDocuments(pendingFilter),
      BookingModel.countDocuments({
        customerId,
        bookingStatus: { $in: ['CANCELLED', 'REJECTED', 'EXPIRED'] },
      }),
      this.deps.reviews.eligible(auth),
      this.deps.wishlists.savedHotelIds(customerId),
      this.deps.support.openCount(customerId),
      BookingModel.find(upcomingFilter)
        .sort({ checkInLocalDate: 1 })
        .limit(3)
        .lean<BookingRecord[]>(),
      BookingModel.find(pendingFilter).sort({ createdAt: -1 }).limit(3).lean<BookingRecord[]>(),
      NotificationModel.find({ userId: customerId }).sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    const reviewBookings = await BookingModel.find({
      customerId,
      bookingReference: { $in: eligible.slice(0, 3).map((e) => e.bookingReference) },
    }).lean<BookingRecord[]>();
    return {
      counts: {
        upcoming: upcomingCount,
        completed,
        pending: pendingCount,
        cancelled,
        pendingReviews: eligible.length,
        savedHotels: saved.length,
        openTickets,
      },
      upcoming: await this.deps.bookings.summaries(upcoming),
      pending: await this.deps.bookings.summaries(pending),
      pendingReviews: await this.deps.bookings.summaries(reviewBookings),
      recentActivity: activity.map((n) => ({
        id: n._id.toString(),
        type: n.type,
        title: n.title,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
        resource: n.resource ?? null,
      })),
    };
  }
}
