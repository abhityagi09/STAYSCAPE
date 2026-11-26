import { z } from 'zod';
import type { HotelCardDto } from '../contracts/marketplace-dto';
import { diffDays } from '../utils/local-date';
import { objectIdSchema } from './common';
import { localDateSchema } from './marketplace';

/** Phase 4: recommendations and price intelligence. */
export const recommendationsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(24).default(8) });

export const priceCalendarQuerySchema = z
  .object({
    from: localDateSchema,
    to: localDateSchema,
    nights: z.coerce.number().int().min(1).max(14).default(1),
    adults: z.coerce.number().int().min(1).max(30).default(2),
    rooms: z.coerce.number().int().min(1).max(9).default(1),
  })
  .refine((q) => diffDays(q.from, q.to) >= 0 && diffDays(q.from, q.to) <= 30, { message: 'Choose up to 31 check-in dates', path: ['to'] });

export const priceHistoryQuerySchema = z.object({ stayDate: localDateSchema });

export const createPriceAlertSchema = z
  .strictObject({
    hotelId: objectIdSchema,
    checkIn: localDateSchema,
    checkOut: localDateSchema,
    adults: z.number().int().min(1).max(30).default(2),
    rooms: z.number().int().min(1).max(9).default(1),
    /** Notify when the lowest total falls to or below this; otherwise on any drop. */
    targetTotalMinor: z.number().int().min(1).nullable().default(null),
  })
  .refine((a) => diffDays(a.checkIn, a.checkOut) >= 1 && diffDays(a.checkIn, a.checkOut) <= 30, { message: 'Stays of 1–30 nights', path: ['checkOut'] });

export const lastMinuteQuerySchema = z.object({
  city: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(24).default(12),
});

export interface RecommendationDto {
  hotel: HotelCardDto;
  /** Human-readable reasons, from the signals that produced the score. */
  reasons: string[];
  score: number;
}
export interface RecommendationsDto {
  personalized: boolean;
  items: RecommendationDto[];
}
export interface PriceCalendarDayDto {
  checkIn: string;
  checkOut: string;
  available: boolean;
  lowestTotalMinor: number | null;
  nightlyAverageMinor: number | null;
  currency: string | null;
  roomTypeName: string | null;
}
export interface PriceHistoryPointDto {
  observedOn: string;
  lowestNightlyMinor: number;
}
export interface PriceAlertDto {
  id: string;
  hotelId: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
  targetTotalMinor: number | null;
  baselineTotalMinor: number | null;
  lastSeenTotalMinor: number | null;
  lastNotifiedTotalMinor: number | null;
  currency: string | null;
  active: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
}
export interface LastMinuteDealDto {
  hotel: HotelCardDto;
  checkIn: string;
  checkOut: string;
  nightlyMinor: number;
  typicalNightlyMinor: number;
  savingBp: number;
  currency: string;
  observations: number;
}

// ---------------------------------------------------------------- loyalty & referrals
/** 1 point per ₹100 of room charges on completed stays; 1 point = ₹0.10 when redeemed. */
export const LOYALTY_RULES = {
  earnPerMinor: 10_000,
  redeemValueMinorPerPoint: 10,
  minRedeemPoints: 500,
  maxRedeemPoints: 50_000,
  redeemCouponValidDays: 90,
  tiers: [
    { tier: 'MEMBER', minPoints: 0 },
    { tier: 'SILVER', minPoints: 2_000 },
    { tier: 'GOLD', minPoints: 6_000 },
    { tier: 'PLATINUM', minPoints: 15_000 },
  ],
} as const;
export const REFERRAL_RULES = {
  referrerPoints: 500,
  refereePoints: 250,
  minQualifyingSubtotalMinor: 200_000,
  claimWindowDays: 7,
  maxRewardedPerYear: 10,
} as const;
export type LoyaltyTier = (typeof LOYALTY_RULES.tiers)[number]['tier'];
export const redeemPointsSchema = z.strictObject({ points: z.number().int().min(LOYALTY_RULES.minRedeemPoints).max(LOYALTY_RULES.maxRedeemPoints) });
export const claimReferralSchema = z.strictObject({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,12}$/) });

export interface LoyaltyEntryDto {
  id: string;
  type: 'EARN' | 'REVERSE' | 'REDEEM' | 'REDEEM_RELEASE' | 'REFERRAL_BONUS' | 'ADJUST';
  points: number;
  description: string;
  bookingReference: string | null;
  createdAt: string;
}
export interface LoyaltySummaryDto {
  balance: number;
  lifetimeEarned: number;
  last12MonthsEarned: number;
  tier: LoyaltyTier;
  nextTier: { tier: LoyaltyTier; pointsNeeded: number } | null;
  pointValueMinor: number;
  entries: LoyaltyEntryDto[];
}
export interface ReferralSummaryDto {
  code: string;
  rewardedThisYear: number;
  limitPerYear: number;
  referrals: Array<{ status: 'PENDING' | 'REWARDED' | 'REJECTED'; joinedAt: string; rewardedAt: string | null; refereeInitials: string; reason: string | null }>;
  referredBy: { status: 'PENDING' | 'REWARDED' | 'REJECTED' } | null;
}
