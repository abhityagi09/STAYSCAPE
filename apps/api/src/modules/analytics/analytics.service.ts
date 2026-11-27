import type { PipelineStage, Types } from 'mongoose';
import { addDays, dateRange, todayInTimeZone, type CurrencyCode } from '@stayscape/shared';
import { Errors } from '@/lib/errors';
import { BookingModel } from '@/modules/bookings/booking.models';
import type { CouponsService } from '@/modules/coupons/coupons.service';
import type { FinanceService } from '@/modules/finance/finance.service';
import { SettlementModel } from '@/modules/finance/finance.models';
import { HotelModel } from '@/modules/hotels/hotel.model';
import { DailyInventoryModel } from '@/modules/inventory/inventory.models';
import type { PartnerAccessService } from '@/modules/partners/partner-access.service';
import { PartnerModel } from '@/modules/partners/partner.model';
import { LedgerEntryModel } from '@/modules/finance/finance.models';
import { RefundModel } from '@/modules/payments/payment.models';
import { ReviewModel } from '@/modules/reviews/review.models';
import { RoomTypeModel } from '@/modules/rooms/room.models';
import { SupportTicketModel } from '@/modules/support/support.models';
import { UserModel } from '@/modules/users/user.model';
import type { AuthContext } from '@/types/express';
import { HotelDailyStatModel } from './hotel-stats.model';

/**
 * Metric definitions (also in docs/analytics.md). Money is integer minor units; ratios are basis
 * points (10 000 = 100 %). Period = [from, to) as calendar dates; booking events use UTC instants
 * of those dates, stay nights use the property-local `nightly[].date`.
 *
 *  Total reservations      bookings confirmed (payment captured) in the period, incl. later cancelled
 *  Gross booking value     Σ amount the guest owed for those bookings (total incl. taxes and fees,
 *                          before platform-funded coupons) — NOT platform revenue
 *  Recognised room revenue Σ nightly room charge (after rate discounts, excl. taxes/fees) for stay
 *                          nights inside the period of bookings that were not cancelled/rejected
 *  Room nights sold        Σ rooms × nights inside the period for those stays
 *  Available room nights   Σ over active room categories and dates of (totalRooms − blockedRooms)
 *  Occupancy               sold ÷ available
 *  ADR                     recognised room revenue ÷ room nights sold
 *  RevPAR                  recognised room revenue ÷ available room nights
 *  Average booking value   gross booking value ÷ total reservations
 *  Cancellation rate       of reservations confirmed in the period, the share later cancelled/rejected
 *  Guest review score      mean overall score of verified, visible reviews written in the period
 *  Booking conversion      reservations ÷ property detail-page views in the period
 *  Platform commission     Σ PLATFORM_REVENUE ledger entries (net of refund reversals)
 */
export interface PeriodInput {
  from?: string | undefined;
  to?: string | undefined;
  hotelIds?: string[] | undefined;
  currency?: CurrencyCode | undefined;
}

const STAYED = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED'];
const ratioBp = (num: number, den: number) => (den > 0 ? Math.round((num * 10_000) / den) : 0);
const div = (num: number, den: number) => (den > 0 ? Math.round(num / den) : 0);
const utc = (date: string) => new Date(`${date}T00:00:00.000Z`);
const isoDate = (v: string | undefined) => (v ? v.slice(0, 10) : undefined);

export function resolvePeriod(input: { from?: string | undefined; to?: string | undefined }) {
  const to = isoDate(input.to) ?? addDays(todayInTimeZone('Asia/Kolkata'), 1);
  const from = isoDate(input.from) ?? addDays(to, -30);
  if (from >= to) throw Errors.badRequest('The period start must be before its end.');
  const days = dateRange(from, addDays(to, -1)).length;
  if (days > 366) throw Errors.badRequest('Choose a period of at most one year.');
  return { from, to, days, fromUtc: utc(from), toUtc: utc(to) };
}

export function previousPeriod(p: { from: string; days: number }) {
  return resolvePeriod({ from: addDays(p.from, -p.days), to: p.from });
}

export function toCsv(rows: Array<Record<string, string | number | null>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    // Neutralise spreadsheet formula injection and quote when needed.
    const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h] ?? null)).join(','))].join('\n');
}

export class AnalyticsService {
  constructor(private readonly deps: { access: PartnerAccessService; finance: FinanceService; coupons: CouponsService }) {}

  // ------------------------------------------------------------------ shared building blocks
  private async bookingTotals(match: Record<string, unknown>) {
    const [row] = await BookingModel.aggregate<{ count: number; gbv: number; cancelled: number }>([
      { $match: match },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          gbv: { $sum: { $add: ['$priceSnapshot.totals.totalMinor', { $ifNull: ['$priceSnapshot.coupon.discountMinor', 0] }] } },
          cancelled: { $sum: { $cond: [{ $in: ['$bookingStatus', ['CANCELLED', 'REJECTED']] }, 1, 0] } },
        },
      },
    ]);
    return row ?? { count: 0, gbv: 0, cancelled: 0 };
  }

  /** Recognised room revenue and room nights, per date and per room category. */
  private async stayNights(hotelIds: Types.ObjectId[], from: string, to: string, currency: CurrencyCode) {
    const base: PipelineStage[] = [
      { $match: { hotelId: { $in: hotelIds }, bookingStatus: { $in: STAYED }, 'priceSnapshot.currency': currency, checkInLocalDate: { $lt: to }, checkOutLocalDate: { $gt: from } } },
      { $unwind: '$bookingItems' },
      { $unwind: '$bookingItems.nightly' },
      { $match: { 'bookingItems.nightly.date': { $gte: from, $lt: to } } },
    ];
    const [byDate, byRoom] = await Promise.all([
      BookingModel.aggregate<{ _id: string; revenue: number; nights: number }>([...base, { $group: { _id: '$bookingItems.nightly.date', revenue: { $sum: '$bookingItems.nightly.lineMinor' }, nights: { $sum: '$bookingItems.rooms' } } }, { $sort: { _id: 1 } }]),
      BookingModel.aggregate<{ _id: string; revenue: number; nights: number }>([...base, { $group: { _id: '$bookingItems.roomTypeName', revenue: { $sum: '$bookingItems.nightly.lineMinor' }, nights: { $sum: '$bookingItems.rooms' } } }, { $sort: { revenue: -1 } }]),
    ]);
    return { byDate, byRoom };
  }

  /** Available room nights per date: inventory rows where they exist, the category's room count otherwise. */
  private async availability(hotelIds: Types.ObjectId[], from: string, to: string): Promise<Map<string, number>> {
    const roomTypes = await RoomTypeModel.find({ hotelId: { $in: hotelIds }, status: 'ACTIVE' }, { totalInventory: 1 }).lean<Array<{ _id: Types.ObjectId; totalInventory: number }>>();
    const dates = dateRange(from, addDays(to, -1));
    const defaultTotal = roomTypes.reduce((s, r) => s + r.totalInventory, 0);
    const result = new Map(dates.map((d) => [d, defaultTotal]));
    if (roomTypes.length === 0) return result;
    const totals = new Map(roomTypes.map((r) => [r._id.toString(), r.totalInventory]));
    const rows = await DailyInventoryModel.find(
      { roomTypeId: { $in: roomTypes.map((r) => r._id) }, localDate: { $gte: from, $lt: to } },
      { roomTypeId: 1, localDate: 1, totalRooms: 1, blockedRooms: 1 },
    ).lean<Array<{ roomTypeId: Types.ObjectId; localDate: string; totalRooms: number; blockedRooms: number }>>();
    // Replace the category default with the stored row (which reflects blocks and closures).
    for (const row of rows) {
      const fallback = totals.get(row.roomTypeId.toString()) ?? 0;
      result.set(row.localDate, (result.get(row.localDate) ?? 0) - fallback + Math.max(0, row.totalRooms - row.blockedRooms));
    }
    return result;
  }

  // ------------------------------------------------------------------ partner
  private async partnerHotelIds(auth: AuthContext, requested?: string[]): Promise<Types.ObjectId[]> {
    const allowed = await this.deps.access.hotelIdsWithPermission(auth, 'analytics:view');
    if (allowed.length === 0) throw Errors.forbidden('You do not have analytics access to any property.');
    if (!requested?.length) return allowed;
    const picked = allowed.filter((id) => requested.includes(id.toString()));
    // Asking for a property outside your access is reported the same as a missing one.
    if (picked.length !== new Set(requested).size) throw Errors.notFound('Property');
    return picked;
  }

  async partnerDashboard(auth: AuthContext, input: PeriodInput) {
    const hotelIds = await this.partnerHotelIds(auth, input.hotelIds);
    const period = resolvePeriod(input);
    const currency = input.currency ?? 'INR';
    const today = todayInTimeZone('Asia/Kolkata');
    const confirmedInPeriod = { hotelId: { $in: hotelIds }, confirmedAt: { $gte: period.fromUtc, $lt: period.toUtc }, 'priceSnapshot.currency': currency };
    const [bookings, stays, availability, arrivals, inHouse, completed, cancelledInPeriod, reviews, views, prevBookings] = await Promise.all([
      this.bookingTotals(confirmedInPeriod),
      this.stayNights(hotelIds, period.from, period.to, currency),
      this.availability(hotelIds, period.from, period.to),
      BookingModel.countDocuments({ hotelId: { $in: hotelIds }, bookingStatus: 'CONFIRMED', checkInLocalDate: { $gte: today, $lt: addDays(today, 7) } }),
      BookingModel.aggregate<{ bookings: number; guests: number }>([{ $match: { hotelId: { $in: hotelIds }, bookingStatus: 'CHECKED_IN' } }, { $group: { _id: null, bookings: { $sum: 1 }, guests: { $sum: '$totalGuests' } } }]),
      BookingModel.countDocuments({ hotelId: { $in: hotelIds }, bookingStatus: { $in: ['CHECKED_OUT', 'COMPLETED'] }, checkOutLocalDate: { $gte: period.from, $lt: period.to } }),
      BookingModel.countDocuments({ hotelId: { $in: hotelIds }, confirmedAt: { $ne: null }, bookingStatus: { $in: ['CANCELLED', 'REJECTED'] }, cancelledAt: { $gte: period.fromUtc, $lt: period.toUtc } }),
      ReviewModel.aggregate<{ avg: number; count: number }>([{ $match: { hotelId: { $in: hotelIds }, status: { $in: ['PUBLISHED', 'FLAGGED'] }, createdAt: { $gte: period.fromUtc, $lt: period.toUtc } } }, { $group: { _id: null, avg: { $avg: '$overallTenths' }, count: { $sum: 1 } } }]),
      HotelDailyStatModel.aggregate<{ views: number }>([{ $match: { hotelId: { $in: hotelIds }, date: { $gte: period.from, $lt: period.to } } }, { $group: { _id: null, views: { $sum: '$views' } } }]),
      this.bookingTotals({ ...confirmedInPeriod, confirmedAt: { $gte: previousPeriod(period).fromUtc, $lt: period.fromUtc } }),
    ]);
    const revenue = stays.byDate.reduce((s, d) => s + d.revenue, 0);
    const sold = stays.byDate.reduce((s, d) => s + d.nights, 0);
    const available = [...availability.values()].reduce((s, v) => s + v, 0);
    const byDate = new Map(stays.byDate.map((d) => [d._id, d]));
    const trend = [...availability.entries()].map(([date, avail]) => {
      const d = byDate.get(date);
      return { date, revenueMinor: d?.revenue ?? 0, roomNightsSold: d?.nights ?? 0, availableRoomNights: avail, occupancyBp: ratioBp(d?.nights ?? 0, avail) };
    });
    const bookingTrend = await BookingModel.aggregate<{ _id: string; bookings: number; cancellations: number }>([
      { $match: confirmedInPeriod },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$confirmedAt' } }, bookings: { $sum: 1 }, cancellations: { $sum: { $cond: [{ $in: ['$bookingStatus', ['CANCELLED', 'REJECTED']] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]);
    const reviewTrend = await ReviewModel.aggregate<{ _id: string; avg: number; count: number }>([
      { $match: { hotelId: { $in: hotelIds }, status: { $in: ['PUBLISHED', 'FLAGGED'] }, createdAt: { $gte: period.fromUtc, $lt: period.toUtc } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, avg: { $avg: '$overallTenths' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    return {
      period: { from: period.from, to: period.to, currency },
      hotelIds: hotelIds.map(String),
      kpis: {
        totalReservations: bookings.count,
        upcomingArrivals: arrivals,
        currentGuests: inHouse[0]?.guests ?? 0,
        inHouseBookings: inHouse[0]?.bookings ?? 0,
        completedStays: completed,
        cancelledBookings: cancelledInPeriod,
        grossBookingValueMinor: bookings.gbv,
        recognisedRoomRevenueMinor: revenue,
        roomNightsSold: sold,
        availableRoomNights: available,
        occupancyBp: ratioBp(sold, available),
        adrMinor: div(revenue, sold),
        revparMinor: div(revenue, available),
        averageBookingValueMinor: div(bookings.gbv, bookings.count),
        cancellationRateBp: ratioBp(bookings.cancelled, bookings.count),
        guestReviewScore: reviews[0] ? Math.round(reviews[0].avg) / 10 : null,
        reviewCount: reviews[0]?.count ?? 0,
        detailViews: views[0]?.views ?? 0,
        bookingConversionBp: ratioBp(bookings.count, views[0]?.views ?? 0),
        previousPeriod: { totalReservations: prevBookings.count, grossBookingValueMinor: prevBookings.gbv },
      },
      trend,
      bookingTrend: bookingTrend.map((b) => ({ date: b._id, bookings: b.bookings, cancellations: b.cancellations })),
      roomPerformance: stays.byRoom.map((r) => ({ roomType: r._id, roomNightsSold: r.nights, revenueMinor: r.revenue, adrMinor: div(r.revenue, r.nights) })),
      reviewTrend: reviewTrend.map((r) => ({ month: r._id, score: Math.round(r.avg) / 10, count: r.count })),
    };
  }

  // ------------------------------------------------------------------ platform (admin)
  private async platformMetrics(period: ReturnType<typeof resolvePeriod>) {
    const range = { $gte: period.fromUtc, $lt: period.toUtc };
    const [bookings, confirmedNow, ledger, refunds, tickets, reviews] = await Promise.all([
      this.bookingTotals({ confirmedAt: range }),
      BookingModel.countDocuments({ confirmedAt: range, bookingStatus: { $in: STAYED } }),
      this.deps.finance.accountTotals(period.fromUtc, period.toUtc),
      RefundModel.aggregate<{ amount: number; count: number }>([{ $match: { status: 'SUCCEEDED', completedAt: range } }, { $group: { _id: null, amount: { $sum: '$amountMinor' }, count: { $sum: 1 } } }]),
      SupportTicketModel.countDocuments({ createdAt: range }),
      ReviewModel.aggregate<{ avg: number; count: number }>([{ $match: { status: { $in: ['PUBLISHED', 'FLAGGED'] }, createdAt: range } }, { $group: { _id: null, avg: { $avg: '$overallTenths' }, count: { $sum: 1 } } }]),
    ]);
    return {
      totalBookings: bookings.count,
      confirmedBookings: confirmedNow,
      cancelledBookings: bookings.cancelled,
      grossBookingValueMinor: bookings.gbv,
      commissionRevenueMinor: ledger.platformRevenue,
      promotionExpenseMinor: -ledger.promotionExpense,
      refundVolumeMinor: refunds[0]?.amount ?? 0,
      refundCount: refunds[0]?.count ?? 0,
      supportTickets: tickets,
      averageReviewRating: reviews[0] ? Math.round(reviews[0].avg) / 10 : null,
    };
  }

  async adminDashboard(input: PeriodInput & { compare?: boolean }) {
    const period = resolvePeriod(input);
    const [current, previous, customers, activePartners, pendingPartners, published, pendingSettlements, newCustomers] = await Promise.all([
      this.platformMetrics(period),
      input.compare === false ? null : this.platformMetrics(previousPeriod(period)),
      UserModel.countDocuments({ roles: 'CUSTOMER', accountStatus: 'ACTIVE' }),
      PartnerModel.countDocuments({ verificationStatus: 'APPROVED' }),
      PartnerModel.countDocuments({ verificationStatus: 'UNDER_REVIEW' }),
      HotelModel.countDocuments({ publicationStatus: 'PUBLISHED' }),
      SettlementModel.aggregate<{ amount: number; count: number }>([{ $match: { status: { $in: ['PENDING', 'ELIGIBLE', 'ON_HOLD', 'PROCESSING'] } } }, { $group: { _id: null, amount: { $sum: '$netPayableMinor' }, count: { $sum: 1 } } }]),
      UserModel.countDocuments({ createdAt: { $gte: period.fromUtc, $lt: period.toUtc } }),
    ]);
    const delta = (key: keyof typeof current) => {
      const c = current[key];
      const p = previous?.[key];
      if (previous === null || typeof c !== 'number' || typeof p !== 'number') return null;
      return { previous: p, changeBp: p === 0 ? null : Math.round(((c - p) * 10_000) / Math.abs(p)) };
    };
    return {
      period: { from: period.from, to: period.to },
      metrics: {
        ...current,
        totalCustomers: customers,
        newCustomers,
        activePartners,
        pendingPartnerApprovals: pendingPartners,
        publishedProperties: published,
        pendingSettlementsMinor: pendingSettlements[0]?.amount ?? 0,
        pendingSettlementCount: pendingSettlements[0]?.count ?? 0,
      },
      comparison: Object.fromEntries((Object.keys(current) as Array<keyof typeof current>).map((k) => [k, delta(k)])),
    };
  }

  async adminAnalytics(input: PeriodInput) {
    const period = resolvePeriod(input);
    const range = { $gte: period.fromUtc, $lt: period.toUtc };
    const day = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: `$${field}` } });
    const [bookings, commission, refunds, customers, partners, byCity, byType, coupons, support] = await Promise.all([
      BookingModel.aggregate<{ _id: string; bookings: number; gbv: number }>([{ $match: { confirmedAt: range } }, { $group: { _id: day('confirmedAt'), bookings: { $sum: 1 }, gbv: { $sum: { $add: ['$priceSnapshot.totals.totalMinor', { $ifNull: ['$priceSnapshot.coupon.discountMinor', 0] }] } } } }, { $sort: { _id: 1 } }]),
      LedgerEntryModel.aggregate<{ _id: string; amount: number }>([{ $match: { account: 'PLATFORM_REVENUE', occurredAt: range } }, { $group: { _id: day('occurredAt'), amount: { $sum: '$amountMinor' } } }, { $sort: { _id: 1 } }]),
      RefundModel.aggregate<{ _id: string; amount: number; count: number }>([{ $match: { status: 'SUCCEEDED', completedAt: range } }, { $group: { _id: day('completedAt'), amount: { $sum: '$amountMinor' }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      UserModel.aggregate<{ _id: string; count: number }>([{ $match: { createdAt: range } }, { $group: { _id: day('createdAt'), count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      PartnerModel.aggregate<{ _id: string; count: number }>([{ $match: { approvedAt: range } }, { $group: { _id: day('approvedAt'), count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      HotelModel.aggregate<{ _id: string; count: number }>([{ $match: { publicationStatus: 'PUBLISHED' } }, { $group: { _id: '$city', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 12 }]),
      HotelModel.aggregate<{ _id: string; count: number }>([{ $match: { publicationStatus: 'PUBLISHED' } }, { $group: { _id: '$propertyType', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      this.deps.coupons.performance(period.fromUtc, period.toUtc),
      SupportTicketModel.aggregate<{ _id: null; created: number; resolved: number; avgFirstResponseMs: number | null; avgResolutionMs: number | null }>([
        { $match: { createdAt: range } },
        {
          $group: {
            _id: null,
            created: { $sum: 1 },
            resolved: { $sum: { $cond: [{ $in: ['$status', ['RESOLVED', 'CLOSED']] }, 1, 0] } },
            avgFirstResponseMs: { $avg: { $cond: [{ $ifNull: ['$firstResponseAt', false] }, { $subtract: ['$firstResponseAt', '$createdAt'] }, null] } },
            avgResolutionMs: { $avg: { $cond: [{ $ifNull: ['$resolvedAt', false] }, { $subtract: ['$resolvedAt', '$createdAt'] }, null] } },
          },
        },
      ]),
    ]);
    const s = support[0];
    return {
      period: { from: period.from, to: period.to },
      bookingVolume: bookings.map((b) => ({ date: b._id, bookings: b.bookings, grossBookingValueMinor: b.gbv })),
      commissionRevenue: commission.map((c) => ({ date: c._id, amountMinor: c.amount })),
      refunds: refunds.map((r) => ({ date: r._id, amountMinor: r.amount, count: r.count })),
      customerGrowth: customers.map((c) => ({ date: c._id, newCustomers: c.count })),
      partnerGrowth: partners.map((p) => ({ date: p._id, approvedPartners: p.count })),
      propertyDistribution: { byCity: byCity.map((c) => ({ label: c._id, count: c.count })), byType: byType.map((t) => ({ label: t._id, count: t.count })) },
      couponPerformance: coupons.map((c) => ({ code: c._id, redemptions: c.redemptions, released: c.released, discountMinor: c.discountMinor })),
      supportPerformance: {
        created: s?.created ?? 0,
        resolved: s?.resolved ?? 0,
        averageFirstResponseMinutes: s?.avgFirstResponseMs ? Math.round(s.avgFirstResponseMs / 60_000) : null,
        averageResolutionHours: s?.avgResolutionMs ? Math.round(s.avgResolutionMs / 3_600_000) : null,
      },
    };
  }
}
