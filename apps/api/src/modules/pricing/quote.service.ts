import { createHmac, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  CHILD_AGE_ADULT_THRESHOLD,
  addDays,
  stayNights,
  todayInTimeZone,
  type HotelPriceDto,
  type QuoteDto,
  type QuoteRequest,
  type QuoteRevalidationDto,
  type RoomOfferDto,
  type RoomTypePublicDto,
} from '@stayscape/shared';
import type { Config } from '@/config/env';
import { AppError, Errors } from '@/lib/errors';
import { safeEqual } from '@/lib/crypto';
import { HotelModel, type HotelRecord } from '@/modules/hotels/hotel.model';
import type { DayAvailability, InventoryService } from '@/modules/inventory/inventory.service';
import {
  PricingRuleModel,
  RatePlanModel,
  RoomTypeModel,
  type PricingRuleRecord,
  type RatePlanRecord,
  type RoomTypeRecord,
} from '@/modules/rooms/room.models';
import { calculatePrice, distribute, type EngineResult, type EngineRule } from './pricing.engine';

export interface Stay {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childrenAges: number[];
  rooms: number;
  extraBeds?: number;
}

interface PricingContext {
  hotel: HotelRecord;
  roomTypes: RoomTypeRecord[];
  ratePlans: RatePlanRecord[];
  rules: PricingRuleRecord[];
  availability: Map<string, Map<string, DayAvailability>>;
}

type Evaluation =
  { ok: true; result: EngineResult; roomsLeft: number } | { ok: false; reason: string };

/** Guests aged CHILD_AGE_ADULT_THRESHOLD+ count as adults for occupancy and pricing. */
export function effectiveOccupancy(stay: Pick<Stay, 'adults' | 'childrenAges'>) {
  const olderChildren = stay.childrenAges.filter((age) => age >= CHILD_AGE_ADULT_THRESHOLD).length;
  return {
    adults: stay.adults + olderChildren,
    children: stay.childrenAges.length - olderChildren,
  };
}

export function fitsRoom(
  roomType: Pick<RoomTypeRecord, 'maximumAdults' | 'maximumChildren' | 'maximumOccupancy'>,
  adults: number,
  children: number,
  rooms: number,
): boolean {
  const a = distribute(adults, rooms);
  const c = distribute(children, rooms).reverse(); // pair larger child groups with smaller adult groups
  return a.every(
    (n, i) =>
      n >= 1 &&
      n <= roomType.maximumAdults &&
      (c[i] ?? 0) <= roomType.maximumChildren &&
      n + (c[i] ?? 0) <= roomType.maximumOccupancy,
  );
}

function toEngineRule(rule: PricingRuleRecord): EngineRule {
  return {
    id: rule._id.toString(),
    name: rule.name,
    ruleType: rule.ruleType,
    startDate: rule.startDate,
    endDate: rule.endDate,
    daysOfWeek: rule.daysOfWeek ?? [],
    adjustmentType: rule.adjustmentType,
    adjustmentValue: rule.adjustmentValue,
    priority: rule.priority,
    stackingPolicy: rule.stackingPolicy,
    conditions: { ...(rule.conditions ?? {}) },
  };
}

interface QuoteTokenPayload {
  v: 1;
  qid: string;
  hotelId: string;
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childrenAges: number[];
  rooms: number;
  extraBeds: number;
  totalMinor: number;
  currency: string;
  exp: number;
}

export class QuoteService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly config: Pick<Config, 'QUOTE_SIGNING_SECRET' | 'QUOTE_TTL_SECONDS'>,
  ) {}

  /** Load everything needed to price many hotels with a constant number of queries. */
  async loadContexts(
    hotels: HotelRecord[],
    stay: Pick<Stay, 'checkIn' | 'checkOut'>,
    roomTypeFilter: Record<string, unknown> = { status: 'ACTIVE' },
  ): Promise<Map<string, PricingContext>> {
    const hotelIds = hotels.map((h) => h._id);
    const [roomTypes, ratePlans, rules] = await Promise.all([
      RoomTypeModel.find({ hotelId: { $in: hotelIds }, ...roomTypeFilter }).lean<
        RoomTypeRecord[]
      >(),
      RatePlanModel.find({ hotelId: { $in: hotelIds }, active: true }).lean<RatePlanRecord[]>(),
      PricingRuleModel.find({ hotelId: { $in: hotelIds }, active: true }).lean<
        PricingRuleRecord[]
      >(),
    ]);
    // Include the departure date so closed-to-departure restrictions can be checked.
    const dates = [...stayNights(stay.checkIn, stay.checkOut), stay.checkOut];
    const availability = await this.inventory.availabilityFor(roomTypes, dates);
    const contexts = new Map<string, PricingContext>();
    for (const hotel of hotels) {
      const id = hotel._id;
      contexts.set(id.toString(), {
        hotel,
        roomTypes: roomTypes.filter((r) => r.hotelId.equals(id)),
        ratePlans: ratePlans.filter((r) => r.hotelId.equals(id)),
        rules: rules.filter((r) => r.hotelId.equals(id)),
        availability,
      });
    }
    return contexts;
  }

  /** Availability + restrictions + price for one room type and rate plan. */
  evaluate(
    ctx: PricingContext,
    roomType: RoomTypeRecord,
    ratePlan: RatePlanRecord,
    stay: Stay,
    now = new Date(),
  ): Evaluation {
    const nights = stayNights(stay.checkIn, stay.checkOut);
    const today = todayInTimeZone(ctx.hotel.timeZone, now);
    if (stay.checkIn < today)
      return { ok: false, reason: 'The check-in date has already passed at this property.' };
    if (nights.length < ratePlan.minimumStay)
      return { ok: false, reason: `Minimum stay is ${ratePlan.minimumStay} nights.` };
    if (nights.length > ratePlan.maximumStay)
      return { ok: false, reason: `Maximum stay is ${ratePlan.maximumStay} nights.` };
    const occupancy = effectiveOccupancy(stay);
    if (!fitsRoom(roomType, occupancy.adults, occupancy.children, stay.rooms))
      return { ok: false, reason: 'This room does not fit your group.' };

    const days = ctx.availability.get(roomType._id.toString());
    if (!days) return { ok: false, reason: 'Availability unknown.' };
    const arrival = days.get(stay.checkIn);
    if (arrival?.closedToArrival)
      return { ok: false, reason: 'Arrivals are not accepted on this date.' };
    if (days.get(stay.checkOut)?.closedToDeparture)
      return { ok: false, reason: 'Departures are not accepted on this date.' };
    if (arrival?.minimumStay && nights.length < arrival.minimumStay)
      return {
        ok: false,
        reason: `Stays arriving on this date need at least ${arrival.minimumStay} nights.`,
      };
    if (arrival?.maximumStay && nights.length > arrival.maximumStay)
      return {
        ok: false,
        reason: `Stays arriving on this date are limited to ${arrival.maximumStay} nights.`,
      };
    const roomsLeft = Math.min(...nights.map((d) => days.get(d)?.available ?? 0));
    if (roomsLeft < stay.rooms)
      return {
        ok: false,
        reason:
          roomsLeft > 0
            ? `Only ${roomsLeft} room(s) left for these dates.`
            : 'Sold out for these dates.',
      };

    const rules = ctx.rules
      .filter(
        (r) =>
          (!r.roomTypeId || r.roomTypeId.equals(roomType._id)) &&
          (!r.ratePlanId || r.ratePlanId.equals(ratePlan._id)),
      )
      .map(toEngineRule);
    const result = calculatePrice({
      ratePlan: {
        id: ratePlan._id.toString(),
        name: ratePlan.name,
        currency: ratePlan.currency,
        mealPlan: ratePlan.mealPlan,
        basePriceMinor: ratePlan.basePriceMinor,
        includedAdults: ratePlan.includedAdults,
        includedChildren: ratePlan.includedChildren,
        additionalAdultPriceMinor: ratePlan.additionalAdultPriceMinor,
        additionalChildPriceMinor: ratePlan.additionalChildPriceMinor,
        extraBedPriceMinor: ratePlan.extraBedPriceMinor,
        mealSupplementPerGuestMinor: ratePlan.mealSupplementPerGuestMinor,
      },
      rules,
      nights,
      checkIn: stay.checkIn,
      bookingDate: today,
      rooms: stay.rooms,
      adults: occupancy.adults,
      children: occupancy.children,
      extraBeds: stay.extraBeds ?? 0,
      taxConfig: { taxes: ctx.hotel.taxConfig?.taxes ?? [], fees: ctx.hotel.taxConfig?.fees ?? [] },
      occupancyBp: Object.fromEntries(nights.map((d) => [d, days.get(d)?.occupancyBp ?? 0])),
    });
    return { ok: true, result, roomsLeft };
  }

  private sign(payload: QuoteTokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${createHmac('sha256', this.config.QUOTE_SIGNING_SECRET).update(body).digest('base64url')}`;
  }

  private verify(token: string): QuoteTokenPayload | null {
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;
    const expected = createHmac('sha256', this.config.QUOTE_SIGNING_SECRET)
      .update(body)
      .digest('base64url');
    if (!safeEqual(signature, expected)) return null;
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as QuoteTokenPayload;
    } catch {
      return null;
    }
  }

  buildQuote(
    ctx: PricingContext,
    roomType: RoomTypeRecord,
    ratePlan: RatePlanRecord,
    stay: Stay,
    evaluation: Extract<Evaluation, { ok: true }>,
  ): QuoteDto {
    const { result } = evaluation;
    const expiresAt = new Date(Date.now() + this.config.QUOTE_TTL_SECONDS * 1000);
    const token = this.sign({
      v: 1,
      qid: randomUUID(),
      hotelId: ctx.hotel._id.toString(),
      roomTypeId: roomType._id.toString(),
      ratePlanId: ratePlan._id.toString(),
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      adults: stay.adults,
      children: stay.children,
      childrenAges: stay.childrenAges,
      rooms: stay.rooms,
      extraBeds: stay.extraBeds ?? 0,
      totalMinor: result.totals.totalMinor,
      currency: result.currency,
      exp: expiresAt.getTime(),
    });
    return {
      quoteToken: token,
      expiresAt: expiresAt.toISOString(),
      hotel: { id: ctx.hotel._id.toString(), name: ctx.hotel.name, slug: ctx.hotel.slug },
      roomType: { id: roomType._id.toString(), name: roomType.name },
      ratePlan: {
        id: ratePlan._id.toString(),
        name: ratePlan.name,
        mealPlan: ratePlan.mealPlan,
        cancellationPolicy: {
          type: ratePlan.cancellationPolicy.type,
          freeCancellationHours: ratePlan.cancellationPolicy.freeCancellationHours,
          refundBasisPointsAfterDeadline:
            ratePlan.cancellationPolicy.refundBasisPointsAfterDeadline,
          ...(ratePlan.cancellationPolicy.description
            ? { description: ratePlan.cancellationPolicy.description }
            : {}),
        },
      },
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      nights: result.nightly.length,
      rooms: stay.rooms,
      occupancy: {
        adults: stay.adults,
        children: stay.children,
        childrenAges: stay.childrenAges,
        extraBeds: stay.extraBeds ?? 0,
      },
      currency: result.currency,
      nightly: result.nightly,
      taxes: result.taxes,
      fees: result.fees,
      totals: result.totals,
      roomsLeft: evaluation.roomsLeft,
    };
  }

  /** Quote a specific selection. Only published listings unless `allowUnpublished` (partner preview). */
  async quote(
    request: QuoteRequest,
    options: { allowUnpublished?: boolean } = {},
  ): Promise<QuoteDto> {
    const filter: Record<string, unknown> = { _id: request.hotelId };
    if (!options.allowUnpublished) filter.publicationStatus = 'PUBLISHED';
    const hotel = await HotelModel.findOne(filter).lean<HotelRecord>();
    if (!hotel) throw Errors.notFound('Property');
    const ctx = (
      await this.loadContexts([hotel], request, {
        _id: new Types.ObjectId(request.roomTypeId),
        status: 'ACTIVE',
      })
    ).get(hotel._id.toString())!;
    const roomType = ctx.roomTypes[0];
    const ratePlan = ctx.ratePlans.find(
      (r) =>
        r._id.toString() === request.ratePlanId && roomType && r.roomTypeId.equals(roomType._id),
    );
    if (!roomType || !ratePlan) throw Errors.notFound('Room or rate');
    const evaluation = this.evaluate(ctx, roomType, ratePlan, request);
    if (!evaluation.ok) throw new AppError(409, 'CONFLICT', evaluation.reason);
    return this.buildQuote(ctx, roomType, ratePlan, request, evaluation);
  }

  /**
   * Re-check a quote before booking: the signature must be valid and unexpired, and the price is
   * recalculated from current rates and availability. Any difference is reported, never hidden.
   */
  async revalidate(token: string): Promise<QuoteRevalidationDto> {
    const payload = this.verify(token);
    if (!payload)
      return { valid: false, priceChanged: false, reason: 'This quote is not valid.', quote: null };
    if (payload.exp < Date.now())
      return {
        valid: false,
        priceChanged: false,
        reason: 'This quote has expired. Please check the price again.',
        quote: null,
      };
    try {
      const quote = await this.quote({
        hotelId: payload.hotelId,
        roomTypeId: payload.roomTypeId,
        ratePlanId: payload.ratePlanId,
        checkIn: payload.checkIn,
        checkOut: payload.checkOut,
        adults: payload.adults,
        children: payload.children,
        childrenAges: payload.childrenAges,
        rooms: payload.rooms,
        extraBeds: payload.extraBeds,
      });
      const changed =
        quote.totals.totalMinor !== payload.totalMinor || quote.currency !== payload.currency;
      return {
        valid: !changed,
        priceChanged: changed,
        reason: changed ? 'The price for this stay has changed.' : null,
        quote,
      };
    } catch (error) {
      return {
        valid: false,
        priceChanged: false,
        reason: error instanceof AppError ? error.message : 'This stay is no longer available.',
        quote: null,
      };
    }
  }

  /** All rooms and rates of one hotel for a stay (hotel detail page). */
  async roomOffers(
    hotel: HotelRecord,
    stay: Stay,
    toPublicRoom: (r: RoomTypeRecord, plans: RatePlanRecord[]) => RoomTypePublicDto,
  ): Promise<RoomOfferDto[]> {
    const ctx = (await this.loadContexts([hotel], stay)).get(hotel._id.toString())!;
    return ctx.roomTypes.map((roomType) => {
      const plans = ctx.ratePlans.filter((p) => p.roomTypeId.equals(roomType._id));
      const offers: QuoteDto[] = [];
      let reason: string | null =
        plans.length === 0 ? 'No rates are available for this room.' : null;
      for (const plan of plans) {
        const evaluation = this.evaluate(ctx, roomType, plan, stay);
        if (evaluation.ok) offers.push(this.buildQuote(ctx, roomType, plan, stay, evaluation));
        else reason ??= evaluation.reason;
      }
      offers.sort((a, b) => a.totals.totalMinor - b.totals.totalMinor);
      const days = ctx.availability.get(roomType._id.toString());
      const available = Math.min(
        ...stayNights(stay.checkIn, stay.checkOut).map((d) => days?.get(d)?.available ?? 0),
      );
      return {
        roomType: toPublicRoom(roomType, plans),
        available: Math.max(0, available),
        unavailableReason: offers.length ? null : reason,
        offers,
      };
    });
  }

  /** Cheapest bookable offer per hotel (search results). */
  async cheapestOffers(
    hotels: HotelRecord[],
    stay: Stay,
    filters: { freeCancellation?: boolean; breakfast?: boolean } = {},
  ): Promise<Map<string, HotelPriceDto>> {
    const contexts = await this.loadContexts(hotels, stay);
    const out = new Map<string, HotelPriceDto>();
    const nights = stayNights(stay.checkIn, stay.checkOut).length;
    for (const [hotelId, ctx] of contexts) {
      let best: HotelPriceDto | null = null;
      for (const roomType of ctx.roomTypes) {
        for (const plan of ctx.ratePlans.filter((p) => p.roomTypeId.equals(roomType._id))) {
          if (filters.freeCancellation && plan.cancellationPolicy.type !== 'FREE_CANCELLATION')
            continue;
          if (filters.breakfast && plan.mealPlan === 'ROOM_ONLY') continue;
          const evaluation = this.evaluate(ctx, roomType, plan, stay);
          if (!evaluation.ok) continue;
          const total = evaluation.result.totals.totalMinor;
          if (!best || total < best.totalMinor) {
            best = {
              totalMinor: total,
              nightlyAverageMinor: Math.round(total / nights),
              currency: evaluation.result.currency,
              nights,
              rooms: stay.rooms,
              roomTypeName: roomType.name,
              ratePlanName: plan.name,
              mealPlan: plan.mealPlan,
              freeCancellation: plan.cancellationPolicy.type === 'FREE_CANCELLATION',
              roomsLeft: evaluation.roomsLeft,
              taxesIncluded: true,
            };
          }
        }
      }
      if (best) out.set(hotelId, best);
    }
    return out;
  }

  static nextWeekend(today: string): { checkIn: string; checkOut: string } {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const toFriday = (5 - dow + 7) % 7 || 7;
    const checkIn = addDays(today, toFriday);
    return { checkIn, checkOut: addDays(checkIn, 2) };
  }
}
