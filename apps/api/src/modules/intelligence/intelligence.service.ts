import { Schema, Types, model } from 'mongoose';
import {
  addDays,
  dateRange,
  todayInTimeZone,
  type HotelPriceDto,
  type LastMinuteDealDto,
  type PriceAlertDto,
  type PriceCalendarDayDto,
  type PriceHistoryPointDto,
  type RecommendationsDto,
} from '@stayscape/shared';
import { AppError, Errors } from '@/lib/errors';
import type { Logger } from '@/lib/logger';
import { BookingModel } from '@/modules/bookings/booking.models';
import { HotelModel, type HotelRecord } from '@/modules/hotels/hotel.model';
import type { NotificationService } from '@/modules/notifications/notification.service';
import type { QuoteService, Stay } from '@/modules/pricing/quote.service';
import type { SearchService } from '@/modules/search/search.service';
import { CARD_PROJECTION } from '@/modules/search/search.service';
import { RatePlanModel } from '@/modules/rooms/room.models';
import { UserModel } from '@/modules/users/user.model';
import { WishlistModel } from '@/modules/wishlists/wishlist.model';

// ------------------------------------------------------------------ models
/** Lowest bookable nightly price (1 night, 2 adults, 1 room, before taxes) for a stay date, as observed on a day. */
interface PriceObservationAttrs {
  hotelId: Types.ObjectId;
  stayDate: string;
  observedOn: string;
  lowestNightlyMinor: number;
  currency: string;
  createdAt: Date;
}
const observationSchema = new Schema<PriceObservationAttrs>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    stayDate: { type: String, required: true },
    observedOn: { type: String, required: true },
    lowestNightlyMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date(), expires: 60 * 60 * 24 * 400 },
  },
  { versionKey: false },
);
observationSchema.index({ hotelId: 1, stayDate: 1, observedOn: 1 }, { unique: true, name: 'uniq_observation' });
observationSchema.index({ hotelId: 1, observedOn: -1 }, { name: 'hotel_observed' });
export const PriceObservationModel = model<PriceObservationAttrs>('PriceObservation', observationSchema);

interface PriceAlertAttrs {
  userId: Types.ObjectId;
  hotelId: Types.ObjectId;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
  targetTotalMinor: number | null;
  baselineTotalMinor: number | null;
  lastSeenTotalMinor: number | null;
  lastNotifiedTotalMinor: number | null;
  lastNotifiedAt: Date | null;
  currency: string | null;
  active: boolean;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
type PriceAlertRecord = PriceAlertAttrs & { _id: Types.ObjectId };
const alertSchema = new Schema<PriceAlertAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    checkIn: { type: String, required: true },
    checkOut: { type: String, required: true },
    adults: { type: Number, required: true },
    rooms: { type: Number, required: true },
    targetTotalMinor: { type: Number, default: null },
    baselineTotalMinor: { type: Number, default: null },
    lastSeenTotalMinor: { type: Number, default: null },
    lastNotifiedTotalMinor: { type: Number, default: null },
    lastNotifiedAt: { type: Date, default: null },
    currency: { type: String, default: null },
    active: { type: Boolean, default: true },
    lastCheckedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
alertSchema.index({ userId: 1, hotelId: 1, checkIn: 1, checkOut: 1, adults: 1, rooms: 1 }, { unique: true, name: 'uniq_alert' });
alertSchema.index({ active: 1, lastCheckedAt: 1 }, { name: 'active_checked' });
export const PriceAlertModel = model<PriceAlertAttrs>('PriceAlert', alertSchema);

const MAX_ALERTS_PER_USER = 20;
const ALERT_RENOTIFY_MS = 24 * 3_600_000;
const DEAL_MIN_OBSERVATIONS = 7;
const DEAL_MIN_SAVING_BP = 1_500;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

/**
 * Recommendations and price intelligence. Every price shown comes from the real quote engine
 * (`QuoteService`), every observation is a stored engine result — nothing is estimated or invented.
 */
export class IntelligenceService {
  constructor(private readonly deps: { quotes: QuoteService; search: SearchService; notifications: NotificationService; logger: Logger }) {}

  // ------------------------------------------------------------------ recommendations
  /**
   * Deterministic, explainable scoring. Personal signals (own bookings and saved stays) are used only
   * with the user's opt-in consent; otherwise popular, well-rated stays are shown and labelled so.
   *   +3 city of a past stay or saved property    +2 same property type as past stays
   *   +2 nightly price within ±30 % of the user's median   +1 rating ≥ 4.3    tie-break: popularity, id
   * Properties the user stayed at in the last 90 days are left out.
   */
  async recommendations(userId: string | null, limit: number): Promise<RecommendationsDto> {
    const consent = userId ? (await UserModel.findById(userId, { 'preferences.personalization': 1 }).lean<{ preferences?: { personalization?: { recommendations?: boolean } } }>())?.preferences?.personalization?.recommendations === true : false;
    const candidates = await HotelModel.find({ publicationStatus: 'PUBLISHED' }, CARD_PROJECTION).sort({ popularityScore: -1, _id: 1 }).limit(300).lean<HotelRecord[]>();
    if (!consent || !userId) {
      const top = candidates.filter((h) => (h.ratingSummary?.average ?? 0) >= 4 || h.ratingSummary?.count === 0).slice(0, limit);
      const cards = await this.deps.search.cards(top);
      return { personalized: false, items: cards.map((hotel) => ({ hotel, reasons: ['Popular on Stayscape'], score: 0 })) };
    }
    const uid = new Types.ObjectId(userId);
    const [bookings, wishlists] = await Promise.all([
      BookingModel.find({ customerId: uid, confirmedAt: { $ne: null } }, { hotelId: 1, 'hotelSnapshot.city': 1, priceSnapshot: 1, checkInLocalDate: 1, checkOutLocalDate: 1, bookingItems: 1 }).sort({ confirmedAt: -1 }).limit(50).lean<Array<{ hotelId: Types.ObjectId; hotelSnapshot: { city: string }; checkOutLocalDate: string; priceSnapshot: { totals: { roomChargesMinor: number } }; bookingItems: Array<{ nightly: unknown[]; rooms: number }> }>>(),
      WishlistModel.find({ userId: uid }, { 'items.hotelId': 1 }).lean<Array<{ items: Array<{ hotelId: Types.ObjectId }> }>>(),
    ]);
    const savedIds = new Set(wishlists.flatMap((w) => w.items.map((i) => i.hotelId.toString())));
    const signalHotels = await HotelModel.find({ _id: { $in: [...bookings.map((b) => b.hotelId), ...[...savedIds].map((id) => new Types.ObjectId(id))] } }, { city: 1, propertyType: 1 }).lean<Array<{ _id: Types.ObjectId; city: string; propertyType: string }>>();
    const cities = new Set(signalHotels.map((h) => h.city.toLowerCase()));
    const bookedTypes = new Set(signalHotels.filter((h) => bookings.some((b) => b.hotelId.equals(h._id))).map((h) => h.propertyType));
    const recentCutoff = addDays(todayInTimeZone('Asia/Kolkata'), -90);
    const recent = new Set(bookings.filter((b) => b.checkOutLocalDate >= recentCutoff).map((b) => b.hotelId.toString()));
    const nightly = bookings.map((b) => {
      const roomNights = b.bookingItems.reduce((s, i) => s + i.nightly.length * i.rooms, 0);
      return roomNights ? b.priceSnapshot.totals.roomChargesMinor / roomNights : 0;
    }).filter((v) => v > 0);
    const band = nightly.length ? median(nightly) : null;

    if (cities.size === 0 && bookedTypes.size === 0) {
      const cards = await this.deps.search.cards(candidates.slice(0, limit));
      return { personalized: true, items: cards.map((hotel) => ({ hotel, reasons: ['Popular on Stayscape — book or save a stay to personalise this'], score: 0 })) };
    }
    // "From" price per property: its lowest active base rate (published data, not an estimate).
    const fromPrices = new Map(
      (await RatePlanModel.aggregate<{ _id: Types.ObjectId; min: number }>([{ $match: { hotelId: { $in: candidates.map((h) => h._id) }, active: true } }, { $group: { _id: '$hotelId', min: { $min: '$basePriceMinor' } } }])).map((r) => [r._id.toString(), r.min]),
    );
    const scored = candidates
      .filter((h) => !recent.has(h._id.toString()))
      .map((h) => {
        const reasons: string[] = [];
        let score = 0;
        if (cities.has(h.city.toLowerCase())) { score += 3; reasons.push(`In ${h.city}, where you've stayed or saved a property`); }
        if (bookedTypes.has(h.propertyType)) { score += 2; reasons.push(`A ${h.propertyType.toLowerCase()} like your past stays`); }
        const from = fromPrices.get(h._id.toString());
        if (band && from && from >= band * 0.7 && from <= band * 1.3) { score += 2; reasons.push('In your usual price range'); }
        if ((h.ratingSummary?.average ?? 0) >= 4.3 && (h.ratingSummary?.count ?? 0) > 0) { score += 1; reasons.push(`Rated ${h.ratingSummary.average.toFixed(1)} by guests`); }
        return { h, score, reasons };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.h.popularityScore ?? 0) - (a.h.popularityScore ?? 0) || a.h._id.toString().localeCompare(b.h._id.toString()))
      .slice(0, limit);
    const cards = await this.deps.search.cards(scored.map((s) => s.h));
    return { personalized: true, items: scored.map((s, i) => ({ hotel: cards[i]!, reasons: s.reasons, score: s.score })) };
  }

  // ------------------------------------------------------------------ prices
  private async published(idOrSlug: string): Promise<HotelRecord> {
    const hotel = await HotelModel.findOne({ ...(Types.ObjectId.isValid(idOrSlug) ? { _id: idOrSlug } : { slug: idOrSlug.toLowerCase() }), publicationStatus: 'PUBLISHED' }).lean<HotelRecord>();
    if (!hotel) throw Errors.notFound('Property');
    return hotel;
  }

  private async cheapest(hotel: HotelRecord, stay: Stay): Promise<HotelPriceDto | null> {
    return (await this.deps.quotes.cheapestOffers([hotel], stay)).get(hotel._id.toString()) ?? null;
  }

  /** Flexible dates: the lowest real total for each check-in date in the range. */
  async priceCalendar(idOrSlug: string, q: { from: string; to: string; nights: number; adults: number; rooms: number }): Promise<PriceCalendarDayDto[]> {
    const hotel = await this.published(idOrSlug);
    const today = todayInTimeZone(hotel.timeZone);
    const days = dateRange(q.from < today ? today : q.from, q.to);
    const results: PriceCalendarDayDto[] = [];
    for (const checkIn of days) {
      const checkOut = addDays(checkIn, q.nights);
      const best = await this.cheapest(hotel, { checkIn, checkOut, adults: q.adults, children: 0, childrenAges: [], rooms: q.rooms });
      results.push({ checkIn, checkOut, available: Boolean(best), lowestTotalMinor: best?.totalMinor ?? null, nightlyAverageMinor: best?.nightlyAverageMinor ?? null, currency: best?.currency ?? null, roomTypeName: best?.roomTypeName ?? null });
    }
    return results;
  }

  async priceHistory(idOrSlug: string, stayDate: string): Promise<PriceHistoryPointDto[]> {
    const hotel = await this.published(idOrSlug);
    const rows = await PriceObservationModel.find({ hotelId: hotel._id, stayDate }).sort({ observedOn: 1 }).lean<PriceObservationAttrs[]>();
    return rows.map((r) => ({ observedOn: r.observedOn, lowestNightlyMinor: r.lowestNightlyMinor }));
  }

  /** Scheduled daily: record the lowest 1-night price for each of the next `days` stay dates. Idempotent per day. */
  async observePrices(days = 60): Promise<number> {
    let written = 0;
    const hotels = await HotelModel.find({ publicationStatus: 'PUBLISHED' }).lean<HotelRecord[]>();
    for (const hotel of hotels) {
      const today = todayInTimeZone(hotel.timeZone);
      const ops = [];
      for (const stayDate of dateRange(today, addDays(today, days - 1))) {
        const best = await this.cheapest(hotel, { checkIn: stayDate, checkOut: addDays(stayDate, 1), adults: 2, children: 0, childrenAges: [], rooms: 1 });
        if (!best) continue;
        ops.push({ updateOne: { filter: { hotelId: hotel._id, stayDate, observedOn: today }, update: { $setOnInsert: { lowestNightlyMinor: best.nightlyAverageMinor, currency: best.currency, createdAt: new Date() } }, upsert: true } });
      }
      if (ops.length) written += (await PriceObservationModel.bulkWrite(ops, { ordered: false })).upsertedCount;
    }
    return written;
  }

  /** Last-minute deals: arrivals within 3 days priced ≥ 15 % under the property's observed median. */
  async lastMinuteDeals(q: { city?: string | undefined; limit: number }): Promise<LastMinuteDealDto[]> {
    const filter: Record<string, unknown> = { publicationStatus: 'PUBLISHED' };
    if (q.city) filter.city = new RegExp(`^${q.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const hotels = await HotelModel.find(filter).sort({ popularityScore: -1 }).limit(60).lean<HotelRecord[]>();
    const deals: Array<Omit<LastMinuteDealDto, 'hotel'> & { h: HotelRecord }> = [];
    for (const hotel of hotels) {
      const today = todayInTimeZone(hotel.timeZone);
      const since = addDays(today, -60);
      const history = await PriceObservationModel.find({ hotelId: hotel._id, observedOn: { $gte: since } }, { lowestNightlyMinor: 1, currency: 1 }).lean<PriceObservationAttrs[]>();
      // Without enough history there is no honest "typical price" to compare against.
      if (history.length < DEAL_MIN_OBSERVATIONS) continue;
      const typical = median(history.map((o) => o.lowestNightlyMinor));
      for (const offset of [0, 1, 2, 3]) {
        const checkIn = addDays(today, offset);
        const best = await this.cheapest(hotel, { checkIn, checkOut: addDays(checkIn, 1), adults: 2, children: 0, childrenAges: [], rooms: 1 });
        if (!best || best.currency !== history[0]!.currency) continue;
        const saving = Math.round(((typical - best.nightlyAverageMinor) * 10_000) / typical);
        if (saving >= DEAL_MIN_SAVING_BP) {
          deals.push({ h: hotel, checkIn, checkOut: addDays(checkIn, 1), nightlyMinor: best.nightlyAverageMinor, typicalNightlyMinor: typical, savingBp: saving, currency: best.currency, observations: history.length });
          break;
        }
      }
    }
    deals.sort((a, b) => b.savingBp - a.savingBp);
    const top = deals.slice(0, q.limit);
    const cards = await this.deps.search.cards(top.map((d) => d.h));
    return top.map(({ h: _h, ...d }, i) => ({ hotel: cards[i]!, ...d }));
  }

  // ------------------------------------------------------------------ alerts
  private async alertDtos(rows: PriceAlertRecord[]): Promise<PriceAlertDto[]> {
    const hotels = await HotelModel.find({ _id: { $in: rows.map((r) => r.hotelId) } }, { name: 1 }).lean<Array<{ _id: Types.ObjectId; name: string }>>();
    return rows.map((r) => ({
      id: r._id.toString(),
      hotelId: r.hotelId.toString(),
      hotelName: hotels.find((h) => h._id.equals(r.hotelId))?.name ?? '',
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      adults: r.adults,
      rooms: r.rooms,
      targetTotalMinor: r.targetTotalMinor,
      baselineTotalMinor: r.baselineTotalMinor,
      lastSeenTotalMinor: r.lastSeenTotalMinor,
      lastNotifiedTotalMinor: r.lastNotifiedTotalMinor,
      currency: r.currency,
      active: r.active,
      lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async listAlerts(userId: string) {
    return this.alertDtos(await PriceAlertModel.find({ userId }).sort({ createdAt: -1 }).limit(50).lean<PriceAlertRecord[]>());
  }

  async createAlert(userId: string, input: { hotelId: string; checkIn: string; checkOut: string; adults: number; rooms: number; targetTotalMinor: number | null }) {
    const hotel = await this.published(input.hotelId);
    if (input.checkIn < todayInTimeZone(hotel.timeZone)) throw Errors.validation({ fieldErrors: { checkIn: ['Choose a future date'] } });
    if ((await PriceAlertModel.countDocuments({ userId, active: true })) >= MAX_ALERTS_PER_USER) throw new AppError(409, 'CONFLICT', `You can watch up to ${MAX_ALERTS_PER_USER} stays at a time.`);
    const best = await this.cheapest(hotel, { checkIn: input.checkIn, checkOut: input.checkOut, adults: input.adults, children: 0, childrenAges: [], rooms: input.rooms });
    const key = { userId: new Types.ObjectId(userId), hotelId: hotel._id, checkIn: input.checkIn, checkOut: input.checkOut, adults: input.adults, rooms: input.rooms };
    // De-duplicated: the same stay can only be watched once per user (re-activated instead).
    const row = await PriceAlertModel.findOneAndUpdate(
      key,
      { $set: { targetTotalMinor: input.targetTotalMinor, active: true }, $setOnInsert: { baselineTotalMinor: best?.totalMinor ?? null, lastSeenTotalMinor: best?.totalMinor ?? null, currency: best?.currency ?? null, lastCheckedAt: new Date() } },
      { upsert: true, new: true },
    ).lean<PriceAlertRecord>();
    return (await this.alertDtos([row!]))[0]!;
  }

  async deleteAlert(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Alert');
    const res = await PriceAlertModel.deleteOne({ _id: id, userId });
    if (res.deletedCount === 0) throw Errors.notFound('Alert');
  }

  /**
   * Scheduled: re-price active alerts. Notifies when the price drops to/below the target (or below
   * the baseline when no target), strictly below the last notified price, at most once per 24 h.
   */
  async checkAlerts(now = new Date(), batch = 200): Promise<{ checked: number; notified: number; expired: number }> {
    const alerts = await PriceAlertModel.find({ active: true }).sort({ lastCheckedAt: 1 }).limit(batch).lean<PriceAlertRecord[]>();
    let notified = 0;
    let expired = 0;
    for (const a of alerts) {
      const hotel = await HotelModel.findById(a.hotelId).lean<HotelRecord>();
      if (!hotel || hotel.publicationStatus !== 'PUBLISHED' || a.checkIn < todayInTimeZone(hotel.timeZone)) {
        await PriceAlertModel.updateOne({ _id: a._id }, { $set: { active: false, lastCheckedAt: now } });
        expired += 1;
        continue;
      }
      const best = await this.cheapest(hotel, { checkIn: a.checkIn, checkOut: a.checkOut, adults: a.adults, children: 0, childrenAges: [], rooms: a.rooms });
      const price = best?.totalMinor ?? null;
      const threshold = a.targetTotalMinor ?? (a.baselineTotalMinor !== null ? a.baselineTotalMinor - 1 : null);
      const below = price !== null && threshold !== null && price <= threshold;
      const newLow = price !== null && (a.lastNotifiedTotalMinor === null || price < a.lastNotifiedTotalMinor);
      const cooled = !a.lastNotifiedAt || now.getTime() - a.lastNotifiedAt.getTime() >= ALERT_RENOTIFY_MS;
      // Claim the notification atomically so overlapping runs cannot notify twice.
      const claim = below && newLow && cooled
        ? await PriceAlertModel.updateOne(
            { _id: a._id, $or: [{ lastNotifiedTotalMinor: null }, { lastNotifiedTotalMinor: { $gt: price } }], ...(a.lastNotifiedAt ? { lastNotifiedAt: a.lastNotifiedAt } : { lastNotifiedAt: null }) },
            { $set: { lastNotifiedTotalMinor: price, lastNotifiedAt: now, lastSeenTotalMinor: price, lastCheckedAt: now, currency: best!.currency } },
          )
        : null;
      if (claim?.modifiedCount === 1) {
        notified += 1;
        await this.deps.notifications.notifyInApp({
          userId: a.userId.toString(),
          type: 'PRICE_ALERT',
          title: `Price drop at ${hotel.name}`,
          body: `${a.checkIn} → ${a.checkOut}: now ${(price! / 100).toLocaleString('en-IN', { style: 'currency', currency: best!.currency })} total.`,
          resource: { type: 'hotel', id: hotel.slug },
        });
      } else {
        await PriceAlertModel.updateOne({ _id: a._id }, { $set: { lastSeenTotalMinor: price, lastCheckedAt: now } });
      }
    }
    return { checked: alerts.length, notified, expired };
  }
}
