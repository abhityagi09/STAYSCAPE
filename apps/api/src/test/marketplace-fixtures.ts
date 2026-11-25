import request from 'supertest';
import sharp from 'sharp';
import type { Express } from 'express';
import { addDays, todayInTimeZone } from '@stayscape/shared';
import { bearer, createUserWithRoles, registerUser, type SignedInUser } from './helpers';

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

let imageCache: Buffer | null = null;
export async function testImage(): Promise<Buffer> {
  imageCache ??= await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#336655' },
  })
    .png()
    .toBuffer();
  return imageCache;
}

export const today = () => todayInTimeZone('Asia/Kolkata');
export const daysFromToday = (n: number) => addDays(today(), n);

export const completeApplication = {
  business: {
    businessName: 'Lakeview Hospitality LLP',
    businessType: 'LLP',
    ownerName: 'Ravi Menon',
  },
  contact: {
    businessAddress: {
      line1: '12 Lake Road',
      city: 'Udaipur',
      state: 'Rajasthan',
      postalCode: '313001',
      country: 'IN',
    },
    contactDetails: { email: 'ops@lakeview.example', phone: '+919812345678' },
  },
  tax: {
    registrationNumber: 'AAB-1234',
    taxDetails: { pan: 'ABCDE1234F', gstin: '08ABCDE1234F1Z5' },
  },
  settlementAccount: {
    accountHolderName: 'Lakeview Hospitality LLP',
    bankName: 'Example Bank',
    ifsc: 'EXMP0001234',
    accountNumber: '123456789012',
  },
};

export async function uploadDoc(
  app: Express,
  user: SignedInUser,
  type: string,
  file = PDF,
  name = 'doc.pdf',
) {
  return request(app)
    .post('/api/v1/partner/application/documents')
    .set(bearer(user.accessToken))
    .field('type', type)
    .attach('file', file, { filename: name, contentType: 'application/pdf' });
}

export async function createAdmin(app: Express) {
  return createUserWithRoles(app, ['ADMIN']);
}

/** Register a user, complete onboarding and have an admin approve it. */
export async function createApprovedPartner(
  app: Express,
  admin: SignedInUser,
): Promise<SignedInUser & { partnerId: string }> {
  const user = await registerUser(app);
  await request(app)
    .put('/api/v1/partner/application')
    .set(bearer(user.accessToken))
    .send(completeApplication)
    .expect(200);
  for (const type of ['BUSINESS_REGISTRATION', 'IDENTITY_PROOF', 'BANK_PROOF'])
    await (
      await uploadDoc(app, user, type)
    ).ok;
  const submitted = await request(app)
    .post('/api/v1/partner/application/submit')
    .set(bearer(user.accessToken))
    .expect(200);
  const partnerId = submitted.body.data.id as string;
  await request(app)
    .post(`/api/v1/admin/partners/${partnerId}/decision`)
    .set(bearer(admin.accessToken))
    .send({ decision: 'APPROVE' })
    .expect(200);
  return { ...user, partnerId };
}

export function hotelContent(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Lakeview Haveli',
    description:
      'A restored lakeside haveli with courtyard rooms, rooftop dining and views across Lake Pichola at sunset.',
    shortDescription: 'Restored haveli on Lake Pichola',
    propertyType: 'BOUTIQUE',
    starCategory: 4,
    address: { line1: '12 Lake Road' },
    city: 'Udaipur',
    state: 'Rajasthan',
    country: 'IN',
    postalCode: '313001',
    location: { lat: 24.576, lng: 73.682 },
    timeZone: 'Asia/Kolkata',
    currency: 'INR',
    contactDetails: { phone: '+919812345678', email: 'stay@lakeview.example' },
    amenities: ['wifi', 'pool', 'breakfast'],
    ...overrides,
  };
}

export const roomTypeInput = (overrides: Record<string, unknown> = {}) => ({
  name: 'Deluxe Lake View',
  description: 'Spacious room overlooking the lake.',
  roomSize: 32,
  roomSizeUnit: 'SQM',
  bedConfiguration: [{ type: 'KING', count: 1 }],
  maximumAdults: 3,
  maximumChildren: 1,
  maximumOccupancy: 3,
  amenities: ['wifi'],
  totalInventory: 5,
  ...overrides,
});

export const ratePlanInput = (roomTypeId: string, overrides: Record<string, unknown> = {}) => ({
  roomTypeId,
  name: 'Flexible',
  mealPlan: 'BREAKFAST',
  cancellationPolicy: {
    type: 'FREE_CANCELLATION',
    freeCancellationHours: 48,
    refundBasisPointsAfterDeadline: 0,
  },
  basePriceMinor: 500_000,
  additionalAdultPriceMinor: 100_000,
  ...overrides,
});

export interface PublishedHotel {
  hotelId: string;
  slug: string;
  roomTypeId: string;
  ratePlanId: string;
}

/** Create, complete, submit, approve and publish a listing through the real API. */
export async function createPublishedHotel(
  app: Express,
  partner: SignedInUser,
  admin: SignedInUser,
  overrides: {
    content?: Record<string, unknown>;
    room?: Record<string, unknown>;
    rate?: Record<string, unknown>;
  } = {},
): Promise<PublishedHotel> {
  const auth = bearer(partner.accessToken);
  const created = await request(app)
    .post('/api/v1/partner/hotels')
    .set(auth)
    .send(hotelContent(overrides.content))
    .expect(201);
  const hotelId = created.body.data.id as string;
  const image = await request(app)
    .post(`/api/v1/partner/hotels/${hotelId}/media`)
    .set(auth)
    .attach('file', await testImage(), { filename: 'cover.png', contentType: 'image/png' })
    .expect(201);
  await request(app)
    .patch(`/api/v1/partner/hotels/${hotelId}`)
    .set(auth)
    .send({
      images: [{ mediaId: image.body.data.id, alt: 'Facade' }],
      coverImageId: image.body.data.id,
    })
    .expect(200);
  const room = await request(app)
    .post(`/api/v1/partner/hotels/${hotelId}/room-types`)
    .set(auth)
    .send(roomTypeInput(overrides.room))
    .expect(201);
  const rate = await request(app)
    .post(`/api/v1/partner/hotels/${hotelId}/rate-plans`)
    .set(auth)
    .send(ratePlanInput(room.body.data.id, overrides.rate))
    .expect(201);
  await request(app).post(`/api/v1/partner/hotels/${hotelId}/submit`).set(auth).expect(200);
  await request(app)
    .post(`/api/v1/admin/hotels/${hotelId}/decision`)
    .set(bearer(admin.accessToken))
    .send({ decision: 'APPROVE' })
    .expect(200);
  await request(app).post(`/api/v1/partner/hotels/${hotelId}/publish`).set(auth).expect(200);
  return {
    hotelId,
    slug: created.body.data.slug,
    roomTypeId: room.body.data.id,
    ratePlanId: rate.body.data.id,
  };
}
