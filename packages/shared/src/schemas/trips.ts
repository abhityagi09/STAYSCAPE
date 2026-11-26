import { z } from 'zod';
import { emailSchema, objectIdSchema } from './common';
import { localDateSchema } from './marketplace';

/** Phase 4: TripSpace (collaborative trip planning) and corporate travel. */
const tripFields = {
  title: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).default(''),
  destination: z.string().trim().max(100).default(''),
  startDate: localDateSchema.nullable().default(null),
  endDate: localDateSchema.nullable().default(null),
};
const datesOk = (t: { startDate: string | null; endDate: string | null }) =>
  !t.startDate || !t.endDate || t.endDate >= t.startDate;
export const tripSchema = z
  .strictObject(tripFields)
  .refine(datesOk, { message: 'End date must be on or after the start date', path: ['endDate'] });
export const tripItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('HOTEL'),
    hotelId: objectIdSchema,
    date: localDateSchema.nullable().default(null),
    note: z.string().trim().max(500).default(''),
  }),
  z.strictObject({
    kind: z.literal('BOOKING'),
    bookingReference: z.string().regex(/^SS-[A-Z0-9]{8}$/),
    note: z.string().trim().max(500).default(''),
  }),
  z.strictObject({
    kind: z.literal('NOTE'),
    title: z.string().trim().min(1).max(120),
    date: localDateSchema.nullable().default(null),
    note: z.string().trim().max(2000).default(''),
  }),
]);
export const tripInviteSchema = z.strictObject({
  email: emailSchema,
  role: z.enum(['EDITOR', 'VIEWER']).default('VIEWER'),
});
export const tripTokenSchema = z.strictObject({ token: z.string().regex(/^[\w-]{40,64}$/) });

export type TripRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export interface TripItemDto {
  id: string;
  kind: 'HOTEL' | 'BOOKING' | 'NOTE';
  title: string;
  note: string;
  date: string | null;
  hotel: { id: string; name: string; slug: string; city: string } | null;
  /** Booking items show only what a trip companion needs — never prices or guest details. */
  booking: { reference: string; checkIn: string; checkOut: string; status: string } | null;
  addedBy: string;
  createdAt: string;
}
export interface TripDto {
  id: string;
  title: string;
  description: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  myRole: TripRole;
  /** Names only: collaborators never see each other's contact details. */
  members: Array<{ userId: string; name: string; role: TripRole }>;
  pendingInvitations: number;
  shared: boolean;
  items: TripItemDto[];
  updatedAt: string;
}
export interface SharedTripDto {
  title: string;
  description: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  items: Array<Pick<TripItemDto, 'kind' | 'title' | 'date' | 'hotel'>>;
}

// ---------------------------------------------------------------- corporate travel
export const ORG_ROLES = ['ORG_ADMIN', 'APPROVER', 'EMPLOYEE'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const createOrganizationSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  billingEmail: emailSchema,
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'Enter a valid 15-character GSTIN')
    .nullable()
    .default(null),
});
export const travelPolicySchema = z.strictObject({
  maxNightlyMinor: z.number().int().min(1).nullable().default(null),
  maxStarCategory: z.number().int().min(1).max(5).nullable().default(null),
  allowedCities: z.array(z.string().trim().min(2).max(80)).max(100).default([]),
  minAdvanceDays: z.number().int().min(0).max(365).default(0),
  approvalRequiredAboveMinor: z.number().int().min(0).nullable().default(null),
  monthlyBudgetMinor: z.number().int().min(0).nullable().default(null),
});
export const orgInviteSchema = z.strictObject({
  email: emailSchema,
  role: z.enum(ORG_ROLES).default('EMPLOYEE'),
  department: z.string().trim().max(60).default(''),
});
export const orgMemberUpdateSchema = z.strictObject({
  role: z.enum(ORG_ROLES),
  department: z.string().trim().max(60).default(''),
});
export const travelRequestSchema = z
  .strictObject({
    hotelId: objectIdSchema,
    roomTypeId: objectIdSchema,
    ratePlanId: objectIdSchema,
    checkIn: localDateSchema,
    checkOut: localDateSchema,
    adults: z.number().int().min(1).max(10).default(1),
    rooms: z.number().int().min(1).max(5).default(1),
    purpose: z.string().trim().min(5).max(500),
  })
  .refine((r) => r.checkOut > r.checkIn, {
    message: 'Check-out must be after check-in',
    path: ['checkOut'],
  });
export const travelDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('APPROVE'), note: z.string().trim().max(500).default('') }),
  z.strictObject({ decision: z.literal('REJECT'), note: z.string().trim().min(3).max(500) }),
]);
export const linkBookingSchema = z.strictObject({
  bookingReference: z.string().regex(/^SS-[A-Z0-9]{8}$/),
});
export const orgDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('APPROVE') }),
  z.strictObject({ decision: z.literal('SUSPEND'), reason: z.string().trim().min(3).max(500) }),
]);
