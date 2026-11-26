import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  PROPERTY_TYPES,
  addDays,
  diffDays,
  searchCriteriaSchema,
  todayInTimeZone,
  type AssistantQuoteDto,
  type HotelCardDto,
} from '@stayscape/shared';
import type { QuoteService } from '@/modules/pricing/quote.service';
import type { SearchService } from '@/modules/search/search.service';

/**
 * The assistant's tools. All are read-only calls into the same services the website uses; the
 * model can only look things up, never book, pay or change data. Arguments are validated here
 * with Zod (the model's output is untrusted), and results are compact JSON.
 */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const toolSchemas = {
  search_hotels: z
    .strictObject({
      city: z.string().trim().min(2).max(80).optional(),
      query: z.string().trim().min(2).max(80).optional(),
      checkIn: date.optional(),
      checkOut: date.optional(),
      adults: z.number().int().min(1).max(10).optional(),
      maxNightlyMinor: z.number().int().min(1).max(100_000_000).optional(),
      propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(4).optional(),
      limit: z.number().int().min(1).max(6).optional(),
    })
    .refine((a) => !a.checkIn === !a.checkOut, 'checkIn and checkOut go together')
    .refine(
      (a) =>
        !a.checkIn ||
        !a.checkOut ||
        (diffDays(a.checkIn, a.checkOut) >= 1 && diffDays(a.checkIn, a.checkOut) <= 30),
      'Stays of 1–30 nights',
    ),
  get_hotel: z.strictObject({ hotelId: z.string().regex(/^[a-f\d]{24}$/i) }),
  quote_stay: z
    .strictObject({
      hotelId: z.string().regex(/^[a-f\d]{24}$/i),
      roomTypeId: z.string().regex(/^[a-f\d]{24}$/i),
      ratePlanId: z.string().regex(/^[a-f\d]{24}$/i),
      checkIn: date,
      checkOut: date,
      adults: z.number().int().min(1).max(10),
      rooms: z.number().int().min(1).max(5).optional(),
    })
    .refine(
      (a) => diffDays(a.checkIn, a.checkOut) >= 1 && diffDays(a.checkIn, a.checkOut) <= 30,
      'Stays of 1–30 nights',
    ),
} as const;
export type ToolName = keyof typeof toolSchemas;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
});
const dateProp = { type: 'string', description: 'Property-local date, YYYY-MM-DD' };
const idProp = {
  type: 'string',
  description: '24-character id returned by an earlier tool result',
};

/** Tool definitions sent to the model (`strict: true` keeps arguments schema-valid). */
export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_hotels',
    description:
      'Search published Stayscape properties. With checkIn/checkOut, only properties with real availability are returned, each with its cheapest bookable total. Returns at most 6 properties.',
    strict: true,
    input_schema: obj({
      city: { type: 'string' },
      query: { type: 'string', description: 'Free text: a name, area or region' },
      checkIn: dateProp,
      checkOut: dateProp,
      adults: { type: 'integer' },
      maxNightlyMinor: {
        type: 'integer',
        description: 'Maximum nightly price in minor units (paise for INR)',
      },
      propertyTypes: { type: 'array', items: { type: 'string', enum: [...PROPERTY_TYPES] } },
      limit: { type: 'integer' },
    }),
  },
  {
    name: 'get_hotel',
    description:
      'Full public details of one property: amenities, policies, accessibility features (with who verified them), rooms and rate plans (ids needed for quote_stay), rating and TrustScore.',
    strict: true,
    input_schema: obj({ hotelId: idProp }, ['hotelId']),
  },
  {
    name: 'quote_stay',
    description:
      'Exact price for a room and rate plan for given dates from the Stayscape pricing engine (includes taxes and fees). Fails if the stay is not available.',
    strict: true,
    input_schema: obj(
      {
        hotelId: idProp,
        roomTypeId: idProp,
        ratePlanId: idProp,
        checkIn: dateProp,
        checkOut: dateProp,
        adults: { type: 'integer' },
        rooms: { type: 'integer' },
      },
      ['hotelId', 'roomTypeId', 'ratePlanId', 'checkIn', 'checkOut', 'adults'],
    ),
  },
];

/** What a turn has seen from tools — the only facts the reply may present. */
export class Evidence {
  readonly hotels = new Map<string, HotelCardDto>();
  readonly quotes: AssistantQuoteDto[] = [];
  readonly amounts = new Set<number>();
  addHotel(h: HotelCardDto) {
    this.hotels.set(h.id, h);
    if (h.price) {
      this.amounts.add(h.price.totalMinor);
      this.amounts.add(h.price.nightlyAverageMinor);
    }
  }
}

const card = (h: HotelCardDto) => ({
  id: h.id,
  name: h.name,
  city: h.city,
  propertyType: h.propertyType,
  stars: h.starCategory,
  rating: h.ratingSummary.count ? h.ratingSummary.average : null,
  reviews: h.ratingSummary.count,
  amenities: h.amenities.slice(0, 8),
  price: h.price
    ? {
        totalMinor: h.price.totalMinor,
        nightlyAverageMinor: h.price.nightlyAverageMinor,
        currency: h.price.currency,
        nights: h.price.nights,
        roomType: h.price.roomTypeName,
      }
    : null,
});

export async function runTool(
  name: string,
  rawInput: unknown,
  deps: { search: SearchService; quotes: QuoteService },
  evidence: Evidence,
): Promise<unknown> {
  if (!(name in toolSchemas)) throw new ToolInputError(`Unknown tool ${name}`);
  const parsed = toolSchemas[name as ToolName].safeParse(rawInput);
  if (!parsed.success)
    throw new ToolInputError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
    );
  const input = parsed.data as Record<string, unknown>;
  if (name === 'search_hotels') {
    const a = input as z.infer<(typeof toolSchemas)['search_hotels']>;
    const criteria = searchCriteriaSchema.parse({
      ...(a.city ? { city: a.city } : {}),
      ...(a.query ? { q: a.query } : {}),
      ...(a.checkIn ? { checkIn: a.checkIn, checkOut: a.checkOut } : {}),
      adults: a.adults ?? 2,
      ...(a.maxNightlyMinor && a.checkIn ? { maxPrice: a.maxNightlyMinor } : {}),
      propertyTypes: a.propertyTypes ?? [],
      limit: a.limit ?? 5,
      page: 1,
    });
    const result = await deps.search.search(criteria);
    result.items.forEach((h) => evidence.addHotel(h));
    return {
      availabilityChecked: result.availabilityChecked,
      total: result.pagination.total,
      hotels: result.items.map(card),
    };
  }
  if (name === 'get_hotel') {
    const d = await deps.search.detail((input as { hotelId: string }).hotelId);
    evidence.addHotel(d);
    return {
      ...card(d),
      description: d.description.slice(0, 600),
      checkInTime: d.checkInTime,
      checkOutTime: d.checkOutTime,
      policies: {
        petsAllowed: d.policies.petsAllowed,
        smokingAllowed: d.policies.smokingAllowed,
        minimumCheckInAge: d.policies.minimumCheckInAge,
        cancellationSummary: d.policies.cancellationSummary ?? null,
      },
      accessibility: d.accessibility.map((f) => ({
        feature: f.label,
        source: f.source === 'ADMIN_VERIFIED' ? 'verified by Stayscape' : 'stated by the property',
      })),
      trustScore: d.trustScore
        ? { score: d.trustScore.score, confidence: d.trustScore.confidence }
        : null,
      rooms: d.roomTypes.map((r) => ({
        roomTypeId: r.id,
        name: r.name,
        maxAdults: r.maximumAdults,
        ratePlans: r.ratePlans.map((p) => ({
          ratePlanId: p.id,
          name: p.name,
          mealPlan: p.mealPlan,
          cancellation: p.cancellationPolicy.type,
        })),
      })),
    };
  }
  const q = input as z.infer<(typeof toolSchemas)['quote_stay']>;
  const quote = await deps.quotes.quote({
    hotelId: q.hotelId,
    roomTypeId: q.roomTypeId,
    ratePlanId: q.ratePlanId,
    checkIn: q.checkIn,
    checkOut: q.checkOut,
    adults: q.adults,
    children: 0,
    childrenAges: [],
    rooms: q.rooms ?? 1,
    extraBeds: 0,
  });
  const row = {
    hotelId: quote.hotel.id,
    hotelName: quote.hotel.name,
    roomTypeName: quote.roomType.name,
    ratePlanName: quote.ratePlan.name,
    checkIn: q.checkIn,
    checkOut: q.checkOut,
    totalMinor: quote.totals.totalMinor,
    currency: quote.currency,
  };
  evidence.quotes.push(row);
  evidence.amounts.add(quote.totals.totalMinor);
  evidence.amounts.add(quote.totals.subtotalMinor);
  return {
    ...row,
    nights: quote.nights,
    taxesMinor: quote.totals.taxesMinor,
    feesMinor: quote.totals.feesMinor,
  };
}

export class ToolInputError extends Error {}

/** Today's date for the prompt (platform default zone; properties use their own for availability). */
export const promptToday = () => todayInTimeZone('Asia/Kolkata');
export const promptHorizon = () => addDays(promptToday(), 365);
