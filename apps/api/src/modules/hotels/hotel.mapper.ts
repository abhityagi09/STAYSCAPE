import { Types } from 'mongoose';
import type { HotelCardDto, HotelContentDto, HotelContentInput, ImageDto } from '@stayscape/shared';
import { toImageDto } from '@/modules/media/media.service';
import type { MediaAssetRecord } from '@/modules/media/media-asset.model';
import {
  CONTENT_FIELDS,
  DEFAULT_POLICIES,
  DEFAULT_TAX_CONFIG,
  type HotelContent,
  type HotelRecord,
} from './hotel.model';

export type ContentPatch = Partial<HotelContent>;

/** Validated API input (lat/lng, string ids) → persistence shape (GeoJSON [lng, lat], ObjectIds). */
export function inputToContent(input: Partial<HotelContentInput>): ContentPatch {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === 'location') {
      const loc = value as { lat: number; lng: number };
      out.location = { type: 'Point', coordinates: [loc.lng, loc.lat] };
    } else if (key === 'images') {
      out.images = (value as Array<{ mediaId: string; alt?: string }>).map((img) => ({
        mediaId: new Types.ObjectId(img.mediaId),
        alt: img.alt ?? '',
      }));
    } else if (key === 'coverImageId') {
      out.coverImageId = value ? new Types.ObjectId(value as string) : null;
    } else {
      out[key] = value;
    }
  }
  return out as ContentPatch;
}

export function pickContent(hotel: HotelRecord): HotelContent {
  const out: Record<string, unknown> = {};
  for (const key of CONTENT_FIELDS) out[key] = hotel[key];
  return out as unknown as HotelContent;
}

/** What the partner is editing: live content overlaid with the pending revision, if any. */
export function workingContent(hotel: HotelRecord): HotelContent {
  return { ...pickContent(hotel), ...((hotel.revision?.data as ContentPatch | null) ?? {}) };
}

export function toContentDto(content: HotelContent): HotelContentDto {
  const coords = content.location?.coordinates;
  return {
    name: content.name ?? '',
    description: content.description ?? '',
    shortDescription: content.shortDescription ?? '',
    propertyType: content.propertyType,
    starCategory: content.starCategory ?? 0,
    address: {
      line1: content.address?.line1 ?? '',
      ...(content.address?.line2 ? { line2: content.address.line2 } : {}),
    },
    city: content.city ?? '',
    state: content.state ?? '',
    country: content.country ?? 'IN',
    postalCode: content.postalCode ?? '',
    location: coords ? { lng: coords[0], lat: coords[1] } : null,
    timeZone: content.timeZone ?? 'Asia/Kolkata',
    currency: content.currency ?? 'INR',
    contactDetails: {
      phone: content.contactDetails?.phone ?? '',
      email: content.contactDetails?.email ?? '',
      ...(content.contactDetails?.website ? { website: content.contactDetails.website } : {}),
    },
    amenities: content.amenities ?? [],
    languagesSpoken: content.languagesSpoken ?? [],
    images: (content.images ?? []).map((i) => ({
      mediaId: i.mediaId.toString(),
      alt: i.alt ?? '',
    })),
    coverImageId: content.coverImageId ? content.coverImageId.toString() : null,
    videos: (content.videos ?? []).map((v) => ({ url: v.url, title: v.title ?? '' })),
    policies: { ...DEFAULT_POLICIES, ...(content.policies ?? {}) },
    checkInTime: content.checkInTime ?? '14:00',
    checkOutTime: content.checkOutTime ?? '11:00',
    instantConfirmation: content.instantConfirmation ?? true,
    nearbyAttractions: (content.nearbyAttractions ?? []).map((a) => ({
      name: a.name,
      distanceKm: a.distanceKm,
      category: a.category,
    })),
    taxConfig: content.taxConfig?.taxes
      ? { taxes: content.taxConfig.taxes, fees: content.taxConfig.fees ?? [] }
      : DEFAULT_TAX_CONFIG,
  };
}

/** Convert content DTO back to the input shape for full-schema completeness validation. */
export function contentDtoToInput(dto: HotelContentDto): Record<string, unknown> {
  return {
    ...dto,
    location: dto.location ?? undefined,
    contactDetails: { ...dto.contactDetails, website: dto.contactDetails.website ?? '' },
  };
}

export function imageMap(assets: MediaAssetRecord[]): Map<string, MediaAssetRecord> {
  return new Map(assets.map((a) => [a._id.toString(), a]));
}

export function resolveImages(
  refs: Array<{ mediaId: Types.ObjectId | string; alt?: string }>,
  assets: Map<string, MediaAssetRecord>,
): ImageDto[] {
  return refs.flatMap((ref) => {
    const asset = assets.get(ref.mediaId.toString());
    return asset ? [toImageDto(asset, ref.alt ?? '')] : [];
  });
}

export function coverImage(
  hotel: Pick<HotelRecord, 'coverImageId' | 'images' | 'name'>,
  assets: Map<string, MediaAssetRecord>,
): ImageDto | null {
  const id = hotel.coverImageId?.toString() ?? hotel.images?.[0]?.mediaId.toString();
  const asset = id ? assets.get(id) : undefined;
  if (!asset) return null;
  const alt = hotel.images?.find((i) => i.mediaId.toString() === id)?.alt || hotel.name;
  return toImageDto(asset, alt);
}

export function toCardDto(
  hotel: HotelRecord,
  assets: Map<string, MediaAssetRecord>,
  extra: Pick<HotelCardDto, 'distanceKm' | 'price'> = { distanceKm: null, price: null },
): HotelCardDto {
  const coords = hotel.location?.coordinates ?? [0, 0];
  return {
    id: hotel._id.toString(),
    slug: hotel.slug,
    name: hotel.name,
    propertyType: hotel.propertyType,
    starCategory: hotel.starCategory,
    city: hotel.city,
    state: hotel.state,
    country: hotel.country,
    location: { lng: coords[0], lat: coords[1] },
    shortDescription: hotel.shortDescription,
    coverImage: coverImage(hotel, assets),
    ratingSummary: {
      average: hotel.ratingSummary?.average ?? 0,
      count: hotel.ratingSummary?.count ?? 0,
      source: hotel.ratingSummary?.source ?? 'REVIEWS',
    },
    amenities: hotel.amenities ?? [],
    featured: hotel.featuredStatus === 'FEATURED',
    instantConfirmation: hotel.instantConfirmation,
    ...extra,
  };
}

/** Haversine distance in km (display and sorting only). */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
