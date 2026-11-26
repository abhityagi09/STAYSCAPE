import { TrustService } from '@/modules/trust/trust.service';
import { HotelDailyStatModel } from '@/modules/analytics/hotel-stats.model';
import { Types, type PipelineStage } from 'mongoose';
import {
  FILTER_AMENITIES,
  stayNights,
  todayInTimeZone,
  type AmenityDto,
  type DestinationDto,
  type HotelPriceDto,
  type HotelCardDto,
  type HotelDetailDto,
  type RoomOfferDto,
  type RoomTypePublicDto,
  type SearchCriteria,
  type SearchResultDto,
  type SuggestionDto,
} from '@stayscape/shared';
import { Errors } from '@/lib/errors';
import type { Logger } from '@/lib/logger';
import type { CacheService } from '@/modules/catalog/cache.service';
import {
  AmenityModel,
  DestinationModel,
  SearchEventModel,
  type AmenityRecord,
  type DestinationRecord,
} from '@/modules/catalog/catalog.models';
import { distanceKm, imageMap, resolveImages, toCardDto } from '@/modules/hotels/hotel.mapper';
import { DEFAULT_POLICIES, HotelModel, type HotelRecord } from '@/modules/hotels/hotel.model';
import type { MediaService } from '@/modules/media/media.service';
import type { MediaAssetRecord } from '@/modules/media/media-asset.model';
import { QuoteService, type Stay } from '@/modules/pricing/quote.service';
import {
  RatePlanModel,
  RoomTypeModel,
  type RatePlanRecord,
  type RoomTypeRecord,
} from '@/modules/rooms/room.models';

const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactCI = (v: string) => new RegExp(`^${escapeRegex(v)}$`, 'i');
/** Fields needed for cards — heavy fields (description, revision, taxConfig…) are excluded. */
export const CARD_PROJECTION = {
  name: 1,
  slug: 1,
  propertyType: 1,
  starCategory: 1,
  city: 1,
  state: 1,
  country: 1,
  location: 1,
  shortDescription: 1,
  coverImageId: 1,
  images: { $slice: 1 },
  ratingSummary: 1,
  amenities: 1,
  featuredStatus: 1,
  instantConfirmation: 1,
  popularityScore: 1,
  timeZone: 1,
  currency: 1,
  taxConfig: 1,
  partnerId: 1,
} as const;
/** Aggregation-pipeline form of CARD_PROJECTION ($slice takes an array expression in $project). */
const AGG_CARD_PROJECTION = { ...CARD_PROJECTION, images: { $slice: ['$images', 1] } };
/** Upper bound on hotels priced per date-based search (documented scaling limit). */
const MAX_PRICED_CANDIDATES = 600;

function recommendedScore(
  h: Pick<HotelRecord, 'featuredStatus' | 'popularityScore' | 'ratingSummary'>,
) {
  const rating = h.ratingSummary?.average ?? 0;
  const reviews = h.ratingSummary?.count ?? 0;
  return (
    (h.featuredStatus === 'FEATURED' ? 1000 : 0) +
    rating * 20 * Math.log10(10 + reviews) +
    Math.log10(1 + (h.popularityScore ?? 0)) * 10
  );
}

export class SearchService {
  constructor(
    private readonly quotes: QuoteService,
    private readonly media: MediaService,
    private readonly cache: CacheService,
    private readonly logger: Logger,
    private readonly trust?: TrustService,
  ) {}

  /** Build public hotel cards (shared with wishlists). */
  async cards(
    hotels: HotelRecord[],
    extras: Map<string, Pick<HotelCardDto, 'distanceKm' | 'price'>> = new Map(),
  ): Promise<HotelCardDto[]> {
    const ids = hotels.flatMap((h) =>
      h.coverImageId ? [h.coverImageId] : (h.images ?? []).slice(0, 1).map((i) => i.mediaId),
    );
    const assets = imageMap(await this.media.findImages(ids));
    return hotels.map((h) =>
      toCardDto(h, assets, extras.get(h._id.toString()) ?? { distanceKm: null, price: null }),
    );
  }

  /** Mongo filter for published hotels matching every non-price criterion. */
  private async buildFilter(
    c: SearchCriteria,
  ): Promise<{ filter: Record<string, unknown>; center: { lat: number; lng: number } | null }> {
    const filter: Record<string, unknown> = {
      publicationStatus: 'PUBLISHED',
      location: { $ne: null },
    };
    const and: Array<Record<string, unknown>> = [];
    let center: { lat: number; lng: number } | null =
      c.lat !== undefined && c.lng !== undefined ? { lat: c.lat, lng: c.lng } : null;

    if (c.destination) {
      const destination = await DestinationModel.findOne({
        $or: [{ slug: c.destination.toLowerCase() }, { name: exactCI(c.destination) }],
        active: true,
      }).lean<DestinationRecord>();
      if (destination) {
        and.push({ city: exactCI(destination.city) });
        if (!center)
          center = {
            lng: destination.coordinates.coordinates[0],
            lat: destination.coordinates.coordinates[1],
          };
      } else {
        const pattern = new RegExp(escapeRegex(c.destination), 'i');
        and.push({ $or: [{ city: pattern }, { state: pattern }, { name: pattern }] });
      }
    }
    if (c.city) and.push({ city: exactCI(c.city) });
    if (c.region) and.push({ state: exactCI(c.region) });
    if (c.country) filter.country = c.country;
    if (c.q) {
      const pattern = new RegExp(escapeRegex(c.q), 'i');
      and.push({ $or: [{ name: pattern }, { city: pattern }, { state: pattern }] });
    }
    if (c.propertyTypes.length) filter.propertyType = { $in: c.propertyTypes };
    if (c.stars.length) filter.starCategory = { $in: c.stars };
    if (c.minRating !== undefined) filter['ratingSummary.average'] = { $gte: c.minRating };
    if (c.instantConfirmation) filter.instantConfirmation = true;
    const amenities = new Set(c.amenities);
    if (c.parking) amenities.add(FILTER_AMENITIES.parking);
    if (c.pool) amenities.add(FILTER_AMENITIES.pool);
    if (c.wifi) amenities.add(FILTER_AMENITIES.wifi);
    if (c.petFriendly) amenities.add(FILTER_AMENITIES.petFriendly);
    if (c.accessible) amenities.add(FILTER_AMENITIES.accessible);
    if (amenities.size) filter.amenities = { $all: [...amenities] };
    // Accessibility features, optionally only those checked by Stayscape staff (provenance).
    if (c.accessibilityFeatures?.length)
      filter.accessibilityFeatures = {
        $all: c.accessibilityFeatures.map((code) => ({
          $elemMatch: { code, ...(c.accessibilityVerifiedOnly ? { source: 'ADMIN_VERIFIED' } : {}) },
        })),
      };

    // Without dates, rate-plan-level filters are answered from the hotel's active rate plans.
    if (!c.checkIn && (c.breakfast || c.freeCancellation)) {
      const planFilter: Record<string, unknown> = { active: true };
      if (c.breakfast) planFilter.mealPlan = { $ne: 'ROOM_ONLY' };
      if (c.freeCancellation) planFilter['cancellationPolicy.type'] = 'FREE_CANCELLATION';
      const hotelIds = await RatePlanModel.distinct('hotelId', planFilter);
      filter._id = { $in: hotelIds };
    }
    if (c.bbox) {
      const [minLng, minLat, maxLng, maxLat] = c.bbox;
      filter.location = {
        $geoWithin: {
          $geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [minLng, minLat],
                [maxLng, minLat],
                [maxLng, maxLat],
                [minLng, maxLat],
                [minLng, minLat],
              ],
            ],
          },
        },
      };
      center ??= { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 };
    } else if (c.lat !== undefined && c.lng !== undefined) {
      filter.location = { $geoWithin: { $centerSphere: [[c.lng, c.lat], c.radiusKm / 6378.1] } };
    }
    if (and.length) filter.$and = and;
    return { filter, center };
  }

  async search(c: SearchCriteria): Promise<SearchResultDto> {
    const { filter, center } = await this.buildFilter(c);
    const result =
      c.checkIn && c.checkOut
        ? await this.searchWithDates(c, filter, center)
        : await this.searchWithoutDates(c, filter, center);
    void this.recordSearch(c, result.pagination.total);
    return result;
  }

  /** No dates: DB-side sorting and pagination in one aggregation; no prices are shown. */
  private async searchWithoutDates(
    c: SearchCriteria,
    filter: Record<string, unknown>,
    center: { lat: number; lng: number } | null,
  ): Promise<SearchResultDto> {
    const sort: Record<string, 1 | -1> =
      c.sort === 'rating_desc'
        ? { 'ratingSummary.average': -1, 'ratingSummary.count': -1, _id: 1 }
        : c.sort === 'reviews_desc'
          ? { 'ratingSummary.count': -1, 'ratingSummary.average': -1, _id: 1 }
          : c.sort === 'popularity'
            ? { popularityScore: -1, _id: 1 }
            : c.sort === 'distance'
              ? { distance: 1, _id: 1 }
              : { featuredStatus: 1, popularityScore: -1, 'ratingSummary.average': -1, _id: 1 }; // 'FEATURED' < 'NONE'

    const pipeline: PipelineStage[] = [];
    if (c.sort === 'distance' && center) {
      const { location, ...rest } = filter;
      pipeline.push({
        $geoNear: {
          near: { type: 'Point', coordinates: [center.lng, center.lat] },
          distanceField: 'distance',
          spherical: true,
          query: rest,
          ...(c.bbox || c.lat === undefined ? {} : { maxDistance: c.radiusKm * 1000 }),
        },
      });
      if (location && c.bbox) pipeline.push({ $match: { location } });
    } else {
      pipeline.push({ $match: filter });
    }
    pipeline.push(
      { $sort: sort },
      {
        $facet: {
          items: [
            { $skip: (c.page - 1) * c.limit },
            { $limit: c.limit },
            { $project: AGG_CARD_PROJECTION },
          ],
          total: [{ $count: 'n' }],
        },
      },
    );
    const [facet] = await HotelModel.aggregate<{
      items: HotelRecord[];
      total: Array<{ n: number }>;
    }>(pipeline);
    const items = facet?.items ?? [];
    const total = facet?.total[0]?.n ?? 0;
    const extras = new Map(
      items.map((h) => [
        h._id.toString(),
        {
          price: null,
          distanceKm:
            center && h.location
              ? distanceKm(center, {
                  lng: h.location.coordinates[0],
                  lat: h.location.coordinates[1],
                })
              : null,
        },
      ]),
    );
    return {
      items: await this.cards(items, extras),
      pagination: {
        page: c.page,
        limit: c.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / c.limit)),
      },
      availabilityChecked: false,
      nights: null,
    };
  }

  /**
   * With dates: only hotels that can satisfy every night and the room count are returned, each
   * with a real quote for its cheapest eligible offer. Price filters apply to the average nightly
   * price including taxes and fees.
   */
  private async searchWithDates(
    c: SearchCriteria,
    filter: Record<string, unknown>,
    center: { lat: number; lng: number } | null,
  ): Promise<SearchResultDto> {
    const candidates = await HotelModel.find(filter, CARD_PROJECTION)
      .sort({ _id: 1 })
      .limit(MAX_PRICED_CANDIDATES)
      .lean<HotelRecord[]>();
    const stay: Stay = {
      checkIn: c.checkIn!,
      checkOut: c.checkOut!,
      adults: c.adults,
      children: c.children,
      childrenAges: c.childrenAges,
      rooms: c.rooms,
    };
    const prices = await this.quotes.cheapestOffers(candidates, stay, {
      freeCancellation: c.freeCancellation,
      breakfast: c.breakfast,
    });
    let matches = candidates.filter((h) => {
      const price = prices.get(h._id.toString());
      if (!price) return false;
      if (c.minPrice !== undefined && price.nightlyAverageMinor < c.minPrice) return false;
      if (c.maxPrice !== undefined && price.nightlyAverageMinor > c.maxPrice) return false;
      return true;
    });
    const dist = (h: HotelRecord) =>
      center && h.location
        ? distanceKm(center, { lng: h.location.coordinates[0], lat: h.location.coordinates[1] })
        : null;
    const price = (h: HotelRecord) => prices.get(h._id.toString())!.totalMinor;
    const tie = (a: HotelRecord, b: HotelRecord) => (a._id.toString() < b._id.toString() ? -1 : 1);
    const comparators: Record<SearchCriteria['sort'], (a: HotelRecord, b: HotelRecord) => number> =
      {
        recommended: (a, b) => recommendedScore(b) - recommendedScore(a) || tie(a, b),
        price_asc: (a, b) => price(a) - price(b) || tie(a, b),
        price_desc: (a, b) => price(b) - price(a) || tie(a, b),
        rating_desc: (a, b) =>
          (b.ratingSummary?.average ?? 0) - (a.ratingSummary?.average ?? 0) || tie(a, b),
        reviews_desc: (a, b) =>
          (b.ratingSummary?.count ?? 0) - (a.ratingSummary?.count ?? 0) || tie(a, b),
        distance: (a, b) => (dist(a) ?? Infinity) - (dist(b) ?? Infinity) || tie(a, b),
        popularity: (a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0) || tie(a, b),
      };
    matches = matches.sort(comparators[c.sort]);
    const total = matches.length;
    const page = matches.slice((c.page - 1) * c.limit, c.page * c.limit);
    const extras = new Map(
      page.map((h) => [
        h._id.toString(),
        { price: prices.get(h._id.toString()) ?? null, distanceKm: dist(h) },
      ]),
    );
    return {
      items: await this.cards(page, extras),
      pagination: {
        page: c.page,
        limit: c.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / c.limit)),
      },
      availabilityChecked: true,
      nights: stayNights(c.checkIn!, c.checkOut!).length,
    };
  }

  /** Aggregate-only analytics: no user id, IP address or exact dates are stored. */
  private async recordSearch(c: SearchCriteria, resultCount: number) {
    try {
      const filters = Object.entries(c)
        .filter(([key, value]) =>
          ['propertyTypes', 'stars', 'amenities'].includes(key)
            ? (value as unknown[]).length > 0
            : typeof value === 'boolean' && value,
        )
        .map(([key]) => key);
      if (c.minPrice !== undefined || c.maxPrice !== undefined) filters.push('price');
      if (c.bbox) filters.push('map');
      await SearchEventModel.create({
        destination: (c.destination ?? c.city ?? null)?.toLowerCase().slice(0, 100) ?? null,
        arrivalMonth: c.checkIn ? c.checkIn.slice(0, 7) : null,
        nights: c.checkIn && c.checkOut ? stayNights(c.checkIn, c.checkOut).length : null,
        guests: c.adults + c.children,
        rooms: c.rooms,
        filters,
        sort: c.sort,
        resultCount,
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to record search analytics');
    }
  }

  featured(limit = 8): Promise<HotelCardDto[]> {
    return this.cache.getOrSet(`featured:${limit}`, async () => {
      const hotels = await HotelModel.find({ publicationStatus: 'PUBLISHED' }, CARD_PROJECTION)
        .sort({ featuredStatus: 1, 'ratingSummary.average': -1, _id: 1 })
        .limit(limit)
        .lean<HotelRecord[]>();
      return this.cards(hotels);
    });
  }

  trending(limit = 8): Promise<HotelCardDto[]> {
    return this.cache.getOrSet(`trending:${limit}`, async () => {
      const hotels = await HotelModel.find({ publicationStatus: 'PUBLISHED' }, CARD_PROJECTION)
        .sort({ popularityScore: -1, _id: 1 })
        .limit(limit)
        .lean<HotelRecord[]>();
      return this.cards(hotels);
    });
  }

  async nearby(q: {
    lat: number;
    lng: number;
    radiusKm: number;
    limit: number;
    excludeId?: string | undefined;
  }): Promise<HotelCardDto[]> {
    const query: Record<string, unknown> = { publicationStatus: 'PUBLISHED' };
    if (q.excludeId) query._id = { $ne: new Types.ObjectId(q.excludeId) };
    const hotels = await HotelModel.aggregate<HotelRecord & { distance: number }>([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [q.lng, q.lat] },
          distanceField: 'distance',
          maxDistance: q.radiusKm * 1000,
          spherical: true,
          query,
        },
      },
      { $limit: q.limit },
      { $project: { ...AGG_CARD_PROJECTION, distance: 1 } },
    ]);
    const extras = new Map(
      hotels.map((h) => [
        h._id.toString(),
        { price: null, distanceKm: Math.round(h.distance / 100) / 10 },
      ]),
    );
    return this.cards(hotels, extras);
  }

  private async findPublished(idOrSlug: string): Promise<HotelRecord> {
    const filter = Types.ObjectId.isValid(idOrSlug)
      ? { _id: idOrSlug }
      : { slug: idOrSlug.toLowerCase() };
    const hotel = await HotelModel.findOne({
      ...filter,
      publicationStatus: 'PUBLISHED',
    }).lean<HotelRecord>();
    if (!hotel) throw Errors.notFound('Property');
    return hotel;
  }

  private toPublicRoom(assets: Map<string, MediaAssetRecord>) {
    return (r: RoomTypeRecord, plans: RatePlanRecord[]): RoomTypePublicDto => ({
      id: r._id.toString(),
      name: r.name,
      description: r.description,
      images: resolveImages(r.images, assets),
      roomSize: r.roomSize,
      roomSizeUnit: r.roomSizeUnit,
      bedConfiguration: r.bedConfiguration,
      maximumAdults: r.maximumAdults,
      maximumChildren: r.maximumChildren,
      maximumOccupancy: r.maximumOccupancy,
      amenities: r.amenities,
      ratePlans: plans
        .filter((p) => p.active)
        .map((p) => ({
          id: p._id.toString(),
          name: p.name,
          mealPlan: p.mealPlan,
          cancellationPolicy: {
            type: p.cancellationPolicy.type,
            freeCancellationHours: p.cancellationPolicy.freeCancellationHours,
            refundBasisPointsAfterDeadline: p.cancellationPolicy.refundBasisPointsAfterDeadline,
            ...(p.cancellationPolicy.description
              ? { description: p.cancellationPolicy.description }
              : {}),
          },
        })),
    });
  }

  async detail(idOrSlug: string): Promise<HotelDetailDto> {
    const hotel = await this.findPublished(idOrSlug);
    // Anonymous popularity signal (a view counter) — no personal data involved.
    void HotelModel.updateOne({ _id: hotel._id }, { $inc: { popularityScore: 1 } })
      .exec()
      .catch(() => undefined);
    void HotelDailyStatModel.updateOne({ hotelId: hotel._id, date: todayInTimeZone(hotel.timeZone ?? 'Asia/Kolkata') }, { $inc: { views: 1 } }, { upsert: true })
      .exec()
      .catch(() => undefined);
    const [roomTypes, ratePlans, amenityRecords] = await Promise.all([
      RoomTypeModel.find({ hotelId: hotel._id, status: 'ACTIVE' }).lean<RoomTypeRecord[]>(),
      RatePlanModel.find({ hotelId: hotel._id, active: true }).lean<RatePlanRecord[]>(),
      AmenityModel.find({ code: { $in: hotel.amenities }, active: true }).lean<AmenityRecord[]>(),
    ]);
    const assets = imageMap(
      await this.media.findImages([
        ...hotel.images.map((i) => i.mediaId),
        ...roomTypes.flatMap((r) => r.images.map((i) => i.mediaId)),
      ]),
    );
    const toRoom = this.toPublicRoom(assets);
    return {
      ...toCardDto(hotel, assets),
      description: hotel.description,
      address: {
        line1: hotel.address.line1,
        ...(hotel.address.line2 ? { line2: hotel.address.line2 } : {}),
      },
      postalCode: hotel.postalCode,
      timeZone: hotel.timeZone,
      currency: hotel.currency,
      amenityDetails: amenityRecords.map(toAmenityDto),
      languagesSpoken: hotel.languagesSpoken,
      images: resolveImages(hotel.images, assets),
      videos: hotel.videos,
      policies: { ...DEFAULT_POLICIES, ...hotel.policies },
      checkInTime: hotel.checkInTime,
      checkOutTime: hotel.checkOutTime,
      nearbyAttractions: hotel.nearbyAttractions,
      contactDetails: {
        phone: hotel.contactDetails.phone,
        email: hotel.contactDetails.email,
        ...(hotel.contactDetails.website ? { website: hotel.contactDetails.website } : {}),
      },
      roomTypes: roomTypes.map((r) =>
        toRoom(
          r,
          ratePlans.filter((p) => p.roomTypeId.equals(r._id)),
        ),
      ),
      accessibility: TrustService.toAccessibilityDtos(hotel),
      trustScore: this.trust ? await this.trust.forHotel(hotel).catch(() => null) : null,
    };
  }

  async roomOffers(idOrSlug: string, stay: Stay): Promise<RoomOfferDto[]> {
    const hotel = await this.findPublished(idOrSlug);
    const roomTypes = await RoomTypeModel.find(
      { hotelId: hotel._id, status: 'ACTIVE' },
      { images: 1 },
    ).lean<RoomTypeRecord[]>();
    const assets = imageMap(
      await this.media.findImages(roomTypes.flatMap((r) => r.images.map((i) => i.mediaId))),
    );
    return this.quotes.roomOffers(hotel, stay, this.toPublicRoom(assets));
  }

  async similar(idOrSlug: string, limit = 4): Promise<HotelCardDto[]> {
    const hotel = await this.findPublished(idOrSlug);
    const sameCity = await HotelModel.find(
      { publicationStatus: 'PUBLISHED', _id: { $ne: hotel._id }, city: exactCI(hotel.city) },
      CARD_PROJECTION,
    )
      .sort({ 'ratingSummary.average': -1, _id: 1 })
      .limit(limit)
      .lean<HotelRecord[]>();
    let hotels = sameCity;
    if (hotels.length < limit) {
      const more = await HotelModel.find(
        {
          publicationStatus: 'PUBLISHED',
          _id: { $nin: [hotel._id, ...hotels.map((h) => h._id)] },
          propertyType: hotel.propertyType,
        },
        CARD_PROJECTION,
      )
        .sort({ popularityScore: -1, _id: 1 })
        .limit(limit - hotels.length)
        .lean<HotelRecord[]>();
      hotels = [...hotels, ...more];
    }
    return this.cards(hotels);
  }

  /** Comparison data for up to four published hotels, priced for the dates when given. */
  async compare(q: {
    ids: string[];
    checkIn?: string | undefined;
    checkOut?: string | undefined;
    adults: number;
    rooms: number;
  }) {
    const hotels = await HotelModel.find({
      _id: { $in: q.ids },
      publicationStatus: 'PUBLISHED',
    }).lean<HotelRecord[]>();
    const ordered = q.ids
      .map((id) => hotels.find((h) => h._id.toString() === id))
      .filter((h): h is HotelRecord => Boolean(h));
    let prices = new Map<string, HotelPriceDto>();
    if (q.checkIn && q.checkOut)
      prices = await this.quotes.cheapestOffers(ordered, {
        checkIn: q.checkIn,
        checkOut: q.checkOut,
        adults: q.adults,
        children: 0,
        childrenAges: [],
        rooms: q.rooms,
      });
    const plans = await RatePlanModel.find(
      { hotelId: { $in: ordered.map((h) => h._id) }, active: true },
      { hotelId: 1, mealPlan: 1, cancellationPolicy: 1 },
    ).lean<RatePlanRecord[]>();
    const roomCounts = await RoomTypeModel.aggregate<{
      _id: Types.ObjectId;
      rooms: number;
      categories: number;
    }>([
      { $match: { hotelId: { $in: ordered.map((h) => h._id) }, status: 'ACTIVE' } },
      { $group: { _id: '$hotelId', rooms: { $sum: '$totalInventory' }, categories: { $sum: 1 } } },
    ]);
    const cards = await this.cards(
      ordered,
      new Map(
        ordered.map((h) => [
          h._id.toString(),
          { price: prices.get(h._id.toString()) ?? null, distanceKm: null },
        ]),
      ),
    );
    return cards.map((card, i) => {
      const hotel = ordered[i]!;
      const hotelPlans = plans.filter((p) => p.hotelId.equals(hotel._id));
      const counts = roomCounts.find((r) => r._id.equals(hotel._id));
      return {
        ...card,
        breakfastAvailable:
          hotel.amenities.includes(FILTER_AMENITIES.breakfast) ||
          hotelPlans.some((p) => p.mealPlan !== 'ROOM_ONLY'),
        parking: hotel.amenities.includes(FILTER_AMENITIES.parking),
        pool: hotel.amenities.includes(FILTER_AMENITIES.pool),
        freeCancellationAvailable: hotelPlans.some(
          (p) => p.cancellationPolicy.type === 'FREE_CANCELLATION',
        ),
        cancellationTypes: [...new Set(hotelPlans.map((p) => p.cancellationPolicy.type))],
        roomCategories: counts?.categories ?? 0,
        totalRooms: counts?.rooms ?? 0,
        checkInTime: hotel.checkInTime,
        checkOutTime: hotel.checkOutTime,
        policies: {
          petsAllowed: hotel.policies?.petsAllowed ?? false,
          smokingAllowed: hotel.policies?.smokingAllowed ?? false,
          minimumCheckInAge: hotel.policies?.minimumCheckInAge ?? 18,
        },
        availableForDates: q.checkIn ? prices.has(hotel._id.toString()) : null,
      };
    });
  }

  // ------------------------------------------------------------------ catalog
  amenities(): Promise<AmenityDto[]> {
    return this.cache.getOrSet('amenities', async () =>
      (
        await AmenityModel.find({ active: true })
          .sort({ category: 1, name: 1 })
          .lean<AmenityRecord[]>()
      ).map(toAmenityDto),
    );
  }

  destinations(): Promise<DestinationDto[]> {
    return this.cache.getOrSet('destinations', async () => {
      const destinations = await DestinationModel.find({ active: true })
        .sort({ popularityScore: -1, name: 1 })
        .lean<DestinationRecord[]>();
      const counts = await HotelModel.aggregate<{ _id: string; n: number }>([
        { $match: { publicationStatus: 'PUBLISHED' } },
        { $group: { _id: { $toLower: '$city' }, n: { $sum: 1 } } },
      ]);
      return destinations.map((d) => ({
        id: d._id.toString(),
        name: d.name,
        slug: d.slug,
        city: d.city,
        region: d.region,
        country: d.country,
        coordinates: { lng: d.coordinates.coordinates[0], lat: d.coordinates.coordinates[1] },
        description: d.description,
        imageUrl: d.images[0]?.url ?? null,
        popularityScore: d.popularityScore,
        propertyCount: counts.find((c) => c._id === d.city.toLowerCase())?.n ?? 0,
      }));
    });
  }

  async suggestions(q: string): Promise<SuggestionDto[]> {
    const prefix = new RegExp(`^${escapeRegex(q)}`, 'i');
    const anywhere = new RegExp(escapeRegex(q), 'i');
    const [destinations, hotels] = await Promise.all([
      DestinationModel.find({
        active: true,
        $or: [{ name: prefix }, { city: prefix }, { region: prefix }],
      })
        .sort({ popularityScore: -1 })
        .limit(5)
        .lean<DestinationRecord[]>(),
      HotelModel.find(
        { publicationStatus: 'PUBLISHED', name: anywhere },
        { name: 1, slug: 1, city: 1, state: 1 },
      )
        .sort({ popularityScore: -1, _id: 1 })
        .limit(5)
        .lean<HotelRecord[]>(),
    ]);
    return [
      ...destinations.map((d) => ({
        type: 'destination' as const,
        label: d.name,
        sublabel: `${d.region}, ${d.country}`,
        value: d.slug,
        slug: d.slug,
      })),
      ...hotels.map((h) => ({
        type: 'hotel' as const,
        label: h.name,
        sublabel: `${h.city}, ${h.state}`,
        value: h._id.toString(),
        slug: h.slug,
      })),
    ];
  }

  static weekendFor(timeZone = 'Asia/Kolkata') {
    return QuoteService.nextWeekend(todayInTimeZone(timeZone));
  }
}

export function toAmenityDto(a: AmenityRecord): AmenityDto {
  return {
    code: a.code,
    name: a.name,
    category: a.category,
    icon: a.icon,
    description: a.description,
  };
}
